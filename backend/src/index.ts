import express from 'express';
import multer from 'multer';
import cors from 'cors';
import AdmZip from 'adm-zip';
import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());

// Konfiguriere Multer für Datei-Uploads
const upload = multer({ dest: 'uploads/' });

// Typen für Abhängigkeiten
interface Dep {
  name: string;
  version: string;
  type: string;
  sourceFile?: string;
}

// Manifest Parser Map
const MANIFEST_MAP: Record<string, { ecosystem: string; parse: (content: string) => Dep[] }> = {
  'package.json': {
    ecosystem: 'npm',
    parse: (c: string) => {
      try {
        const pkg = JSON.parse(c);
        return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(
          ([name, version]) => ({ name, version: version as string, type: 'npm' })
        );
      } catch (e) {
        return [];
      }
    }
  },
  'requirements.txt': {
    ecosystem: 'pypi',
    parse: (c: string) =>
      c.split('\n')
       .filter(line => line && !line.startsWith('#') && line.trim() !== '')
       .map(line => {
         const parts = line.split(/[=<>~!]/);
         const name = parts[0]?.trim() || '';
         const version = line.trim().replace(name, '').trim();
         return { name, version, type: 'pypi' };
       }),
  },
  // Weitere Parser (z.B. Cargo.toml, pom.xml) können hier später hinzugefügt werden
};

app.post('/api/analyze', upload.single('project'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const zipPath = req.file.path;
  const extractDir = path.join('temp', req.file.filename);

  try {
    // 1. ZIP entpacken
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // 2. Scan nach Manifest-Dateien
    const manifestFilenames = Object.keys(MANIFEST_MAP);
    // Glob sucht rekursiv nach diesen Dateinamen
    const globPattern = `${extractDir}/**/{${manifestFilenames.join(',')}}`;
    const files = await fg([globPattern], { dot: true });

    const directDeps: Dep[] = [];

    // 3. Manifeste parsen
    for (const file of files) {
      const filename = path.basename(file);
      const content = fs.readFileSync(file, 'utf-8');
      const parser = MANIFEST_MAP[filename];

      if (parser) {
        const deps = parser.parse(content);
        directDeps.push(...deps.map(d => ({ ...d, sourceFile: file.replace(extractDir + '/', '') })));
      }
    }

    // Lese maxDepth Parameter
    const maxDepth = parseInt(req.body.maxDepth) || 2;

    // 4. Graph bauen (für Cytoscape) mit Resolver
    const resolver = await import('./resolver.js');
    const { nodes: resolvedNodes, edges: resolvedEdges } = await resolver.buildGraph(directDeps, maxDepth);

    const nodes: any[] = [{ data: { id: 'root', label: 'Project Root', type: 'root' } }];
    const edges: any[] = [];

    for (const node of resolvedNodes) {
        nodes.push({
          data: {
            id: node.id,
            label: node.name,
            version: node.version,
            type: node.type,
            source: node.sourceFile,
            conflict: node.conflict,
            requestedVersions: node.requestedVersions
          }
        });
    }

    for (const edge of resolvedEdges) {
        edges.push({
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.label
          }
        });
    }

    res.json({ nodes, edges });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process project' });
  } finally {
    // Aufräumen
    try {
      if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to cleanup temp files', e);
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend is running on port ${PORT}`);
});
