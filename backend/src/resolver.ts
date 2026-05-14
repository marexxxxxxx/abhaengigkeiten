import axios from 'axios';
import { LRUCache } from 'lru-cache';
import semver from 'semver';

// Cache for API responses to avoid hitting registries too often
const apiCache = new LRUCache<string, any>({
  max: 1000,
  ttl: 1000 * 60 * 60, // 1 hour
});

interface Dep {
  name: string;
  version: string;
  type: string;
  sourceFile?: string;
  parent?: string;
}

export interface ResolvedNode {
  id: string;
  name: string;
  version: string;
  type: string;
  sourceFile?: string;
  conflict: boolean;
  requestedVersions: Record<string, string[]>; // Map parent -> requested version
}

export interface ResolvedEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

async function fetchNpmDependencies(name: string, versionRange: string): Promise<Dep[]> {
  const cacheKey = `npm:${name}`;
  let data = apiCache.get(cacheKey);

  if (!data) {
    try {
      const response = await axios.get(`https://registry.npmjs.org/${name}`, { timeout: 5000 });
      data = response.data;
      apiCache.set(cacheKey, data);
    } catch (e) {
      console.warn(`Failed to fetch npm package ${name}`);
      return [];
    }
  }

  try {
    // Find matching version, or fallback to latest
    let targetVersion = data['dist-tags']?.latest;
    const versions = Object.keys(data.versions || {});

    // Attempt to resolve exact version using semver if possible
    const maxSatisfying = semver.maxSatisfying(versions, versionRange);
    if (maxSatisfying) {
      targetVersion = maxSatisfying;
    }

    if (!targetVersion || !data.versions[targetVersion]) return [];

    const deps = data.versions[targetVersion].dependencies || {};
    return Object.entries(deps).map(([depName, depVersion]) => ({
      name: depName,
      version: depVersion as string,
      type: 'npm',
    }));
  } catch (e) {
    return [];
  }
}

async function fetchPypiDependencies(name: string): Promise<Dep[]> {
  const cacheKey = `pypi:${name}`;
  let data = apiCache.get(cacheKey);

  if (!data) {
    try {
      const response = await axios.get(`https://pypi.org/pypi/${name}/json`, { timeout: 5000 });
      data = response.data;
      apiCache.set(cacheKey, data);
    } catch (e) {
      console.warn(`Failed to fetch pypi package ${name}`);
      return [];
    }
  }

  try {
    const reqs = data.info?.requires_dist || [];
    return reqs
      .filter((req: string) => !req.includes('extra ==')) // basic filter for extras
      .map((req: string) => {
        // e.g., "certifi (>=2017.4.17)" or "urllib3 (<1.27,>=1.21.1)"
        const parts = req.split(' ');
        const depName = parts[0];
        const depVersion = parts.length > 1 ? parts.slice(1).join(' ').replace(/[()]/g, '') : 'latest';
        return {
          name: depName,
          version: depVersion,
          type: 'pypi',
        };
      });
  } catch (e) {
    return [];
  }
}

async function fetchDependencies(dep: Dep): Promise<Dep[]> {
  if (dep.type === 'npm') {
    return fetchNpmDependencies(dep.name, dep.version);
  } else if (dep.type === 'pypi') {
    return fetchPypiDependencies(dep.name);
  }
  return [];
}

export async function buildGraph(directDeps: Dep[], maxDepth: number) {
  const resolvedNodes = new Map<string, ResolvedNode>();
  const resolvedEdges: ResolvedEdge[] = [];

  // BFS Queue: { dep, parentId, depth }
  const queue: { dep: Dep; parentId: string; depth: number }[] = [];

  for (const dep of directDeps) {
    queue.push({ dep, parentId: 'root', depth: 1 });
  }

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { dep, parentId, depth } = item;
    const nodeId = `${dep.type}:${dep.name}`;

    let node = resolvedNodes.get(nodeId);

    if (!node) {
      // First time seeing this package
      const newNode: ResolvedNode = {
        id: nodeId,
        name: dep.name,
        version: dep.version, // Initially resolved version string
        type: dep.type,
        conflict: false,
        requestedVersions: {},
      };
      if (dep.sourceFile) {
        newNode.sourceFile = dep.sourceFile;
      }
      resolvedNodes.set(nodeId, newNode);
      node = newNode;

      // Only fetch dependencies if we haven't hit the depth limit
      if (depth < maxDepth) {
        const subDeps = await fetchDependencies(dep);
        for (const subDep of subDeps) {
           queue.push({ dep: subDep, parentId: nodeId, depth: depth + 1 });
        }
      }
    }

    if (node) {
      // Record the requested version
      if (!node.requestedVersions[parentId]) {
        node.requestedVersions[parentId] = [];
      }
      if (!node.requestedVersions[parentId].includes(dep.version)) {
        node.requestedVersions[parentId].push(dep.version);
      }
    }

    // Edge creation
    const edgeId = `edge_${parentId}_${nodeId}_${Math.random().toString(36).substring(7)}`;
    resolvedEdges.push({
      id: edgeId,
      source: parentId,
      target: nodeId,
      label: dep.sourceFile || dep.version,
    });
  }

  // Conflict Detection Pass
  for (const node of resolvedNodes.values()) {
    const allRequestedVersions = new Set<string>();

    // Gather all requested version strings
    for (const parentId of Object.keys(node.requestedVersions)) {
      for (const ver of node.requestedVersions[parentId] || []) {
        allRequestedVersions.add(ver);
      }
    }

    // Basic conflict rule: More than 1 distinct requested version string
    // In a real robust system, we would check if they overlap using semver.intersects.
    // For this implementation, if they request different ranges, we flag it as a conflict.
    if (allRequestedVersions.size > 1) {
       node.conflict = true;

       if (node.type === 'npm') {
         // Advanced SemVer check: Do the ranges intersect?
         // If they all intersect, it might not be a real conflict, but it's often useful to know.
         // Let's mark it as conflict if they request strictly different things.
         // For simplicity and visibility in MVP, we just flag differing strings as conflicts.

         const versionsArray = Array.from(allRequestedVersions);
         let hasTrueConflict = false;
         for (let i = 0; i < versionsArray.length; i++) {
           for (let j = i + 1; j < versionsArray.length; j++) {
             // If either is not valid semver range, treat as conflict
             try {
                if (!semver.intersects(versionsArray[i] as string, versionsArray[j] as string)) {
                  hasTrueConflict = true;
                  break;
                }
             } catch(e) {
                // Not valid semver range (e.g. github URL, file path)
                hasTrueConflict = true;
             }
           }
           if (hasTrueConflict) break;
         }

         node.conflict = hasTrueConflict;
       }
    }
  }

  return { nodes: Array.from(resolvedNodes.values()), edges: resolvedEdges };
}
