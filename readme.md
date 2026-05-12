1. Überblick & Technologie-Stack
Ziel: Web-App, die per ZIP-Upload oder Repo-URL alle Abhängigkeiten eines Projekts erkennt, transitiv auflöst und als interaktiven Graphen visualisiert – inklusive Versionskonflikten, Sicherheitslücken und Lizenzkonflikten.

Empfohlener Stack:

Frontend: React + TypeScript + Cytoscape.js (Canvas-Rendering, performant für Graphen bis ~2000 Knoten)

Backend: Node.js (Express) – eine einheitliche Sprache reduziert Kontextwechsel, und npm-Ökosystem-Bibliotheken sind direkt nutzbar.

Caching: Redis (Persistenz und Shared Cache bei Skalierung) oder für die erste Version lru-cache im Speicher.

Parsing: Pro Ökosystem eine kleine Adapter-Funktion; existierende Parser-Bibliotheken wo sinnvoll.

Registry-APIs: npm, PyPI, crates.io, Maven Central, Go-Proxy usw.

2. Architektur (Übersicht)
text
[Browser] -- HTTP --> [Express Server]
                         |
                    [Projekt-Service]
                    /    |        \
         Datei-Scan   Parser-Registry   Registry-Client
              |            |                  |
        (findet alle    (Map Filename    (npm, PyPI, Maven...,
         Manifeste)     -> Parser)       mit Caching & Rate-Limiting)
                           |
                     Abhängigkeits-Auflöser (BFS + Konflikt-Erkennung)
                           |
                     Graph-Builder → JSON
                           |
                     [Sicherheits/Lizenz-Prüfung] (optional, OSV/SPDX)
                           |
          (Antwort: GraphJSON mit Metadaten) --> Frontend (Cytoscape)
Datenfluss:

Benutzer lädt ZIP hoch oder gibt URL ein → Backend lädt Projekt in temporäres Verzeichnis.

Scan-Modul traversiert alle Dateien und prüft gegen eine vordefinierte Liste von Manifest-Dateinamen.

Für jedes erkannte Manifest wird der zugehörige Parser geladen und die direkten Abhängigkeiten extrahiert.

Ein rekursiver BFS-Resolver fragt Registry-APIs ab (mit Caching) und baut einen gemeinsamen Graphen auf.

Der Graph wird aufbereitet (Knoten, Kanten, Konflikt-Markierungen) und an das Frontend gesendet.

Optional werden Sicherheitslücken und Lizenzdaten angereichert.

3. Automatische Erkennung der Paketmanager
Wir verwenden eine Datei-nach-Parser-Map. Jeder Eintrag enthält:

filename: z. B. package.json, requirements.txt, Cargo.toml

ecosystem: String-Identifier (npm, pypi, cargo, maven, go, bundler, composer, nuget)

parser: Funktion (content: string) => Dep[]

resolverStrategy: Verweis auf den Resolver-Typ (für spätere Registry-Phase)

Beispiel-Registry (vereinfacht):

typescript
const MANIFEST_MAP = {
  'package.json': {
    ecosystem: 'npm',
    parse: (c: string) => {
      const pkg = JSON.parse(c);
      return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(
        ([name, version]) => ({ name, version, type: 'npm' })
      );
    },
    resolver: 'npmResolver'
  },
  'requirements.txt': {
    ecosystem: 'pypi',
    parse: (c: string) => 
      c.split('\n')
       .filter(line => line && !line.startsWith('#'))
       .map(line => {
         const [name, ...v] = line.split(/[=<>~!]/); // grob
         return { name: name.trim(), version: line.trim().replace(name, '').trim(), type: 'pypi' };
       }),
    resolver: 'pypiResolver'
  },
  'Cargo.toml': { /* ... */ },
  'pom.xml': {
    ecosystem: 'maven',
    parse: (c: string) => {
      // XML-Parsing mit fast xml2js, extrahiere <dependencies>
      // ...
    },
    resolver: 'mavenResolver'
  },
  // ... go.mod, Gemfile, composer.json, .csproj, etc.
};
Scan-Prozess:

Rekursive Dateisuche mit fast-glob, gesucht nach genau diesen Dateinamen.

Bei pyproject.toml zusätzlich prüfen, ob es Poetry/PEP621 ist.

Bei build.gradle und build.gradle.kts die Dependencies mit Regex/ Grobparse auslesen (Vollständige Gradle-Auflösung ist zu komplex → nur direkte String-Abhängigkeiten erkennen).

Für jede gefundene Datei → Parser aufrufen, Ergebnis in Pool der direkten Abhängigkeiten einfügen.

4. Schritt-für-Schritt-Implementierung (Phasen)
Phase 1: MVP – Nur direkte Abhängigkeiten visualisieren (2–3 Wochen)
Ziel: Upload/URL, Manifest-Scan, Parsen, einfacher Graph (keine transitive Auflösung, keine Konflikterkennung). Damit validieren wir UI und Konzept.

Aufgaben:

Express-Server mit Upload-Endpunkt (/api/analyze) und URL-Endpunkt.

Datei-Scan-Modul (Manifest-Map) implementieren.

Parser für die 3–4 wichtigsten Ökosysteme: npm, PyPI (requirements.txt, pyproject.toml), Cargo, ggf. Maven (pom.xml einfach).

Graph-JSON aufbereiten: pro direktem Dep einen Knoten (id: pypi:requests), Kanten vom Projekt-Wurzelknoten zum Dep.

Frontend: Upload-Formular, grafische Darstellung mit Cytoscape, Knoten-Klick zeigt Details (Name, Version, Quelldatei).

(Optional) Einfaches Caching der Manifest-Inhalte, falls von URL geklont.

Code-Skizze (Backend-Route):

javascript
app.post('/api/analyze', upload.single('project'), async (req, res) => {
  const dir = extractZip(req.file.path);  // entpacken
  const manifestFiles = await scanManifests(dir); 
  const directDeps = [];
  for (const { filename, content } of manifestFiles) {
    const parser = MANIFEST_MAP[path.basename(filename)];
    if (parser) {
      directDeps.push(...parser.parse(content).map(d => ({ ...d, sourceFile: filename })));
    }
  }
  const graph = buildDirectGraph(directDeps); // Knoten & Kanten
  res.json(graph);
});
Graph-Daten für Cytoscape:

json
{
  "nodes": [
    { "data": { "id": "root", "label": "Projekt" } },
    { "data": { "id": "npm:lodash", "label": "lodash", "version": "^4.17.21" } }
  ],
  "edges": [
    { "data": { "source": "root", "target": "npm:lodash", "label": "package.json" } }
  ]
}
Phase 2: Transitive Auflösung & Versionskonflikte (3–4 Wochen)
Ziel: Registry-Abfragen, rekursive Dependency-Auflösung (BFS), Konflikt-Highlighting, Umgang mit großen Graphen.

Herausforderungen direkt adressieren:

a) Versionsschemata normalisieren
Jeder Resolver liefert für eine Abhängigkeit eine konkrete Version (z. B. 4.17.21) und eine normalisierte Vergleichsdarstellung.

Für Semver (npm): semver-Bibliothek, semver.maxSatisfying(versions, range).

Für PEP 440 (PyPI): pep440-utils oder eigene Vereinfachung: Version als Tupel (epoch, release, pre, post, dev) → vergleichbar machen.

Für Maven: maven-version-compare-ähnliche Funktion, die 1.2.3, 1.2-beta korrekt vergleicht.

Wir speichern die Version als String und als normierten semver-artigen String (falls möglich). Für Konflikt-Erkennung reicht der Vergleich auf Ökosystem-Name + Paket-Name, wenn mehrere unterschiedliche Versionen im Graph existieren.

b) Rekursive Auflösung mit Caching und Batch-Strategien
Resolver-Schnittstelle (Pseudocode):

javascript
async function resolveDependencies(rootDeps, maxDepth = 5) {
  const graph = new Map(); // key: `${ecosystem}:${name}@${version}`
  const queue = rootDeps.map(d => ({ ...d, depth: 0 }));
  const seen = new Set(); // vermeidet Doppelarbeit

  while (queue.length > 0) {
    const batch = queue.splice(0, 10); // Batch-Größe 10
    const results = await Promise.allSettled(
      batch.map(async dep => {
        const key = `${dep.ecosystem}:${dep.name}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const resolved = await resolveVersion(dep.ecosystem, dep.name, dep.versionSpec);
        resolved.dependencies.forEach(child => {
          queue.push({ ...child, depth: dep.depth + 1 });
        });
        return resolved;
      })
    );
    // Ergebnisse in Graph einpflegen, Konflikte markieren
  }
  return graph;
}

async function resolveVersion(ecosystem, name, versionSpec) {
  const cacheKey = `resolver:${ecosystem}:${name}:${versionSpec}`;
  let cached = await cache.get(cacheKey);
  if (cached) return cached;

  const versions = await fetchRegistryVersions(ecosystem, name); // mit eigenem Cache
  const version = selectBest(ecosystem, versions, versionSpec);
  const deps = await fetchDependencies(ecosystem, name, version);
  
  const result = { version, dependencies: deps };
  await cache.set(cacheKey, result, { ttl: 3600 }); // 1h
  return result;
}
Timeout- und Fallback-Strategien:

Jeder Registry-Request bekommt einen Timeout (z. B. Promise.race mit 5s).

Bei Fehler: Paket als „unresolved“ markieren, keine weiteren Kinder auflösen.

Concurrent-Limit mit p-limit (z. B. max 20 parallele Requests).

c) Große Graphen (>1000 Knoten)
Im Backend werden die Koordinaten nicht vorberechnet, sondern die Layout-Engine (Cytoscape) übernimmt das Rendering. Cytoscape mit CoSE-Bilkent-Layout verkraftet 1000 Knoten noch flüssig.

Für darüber hinaus: Clustering anbieten: Zusammenfassen von Paketen gleichen Namespace (z. B. @babel/*), oder nach Ökosystem. Im Backend könnten wir Sub-Graphen vorbauen.

Virtuelles Rendering: Nicht nötig, da Cytoscape Canvas-basiert ist; aber wir können ein View-Filter einsetzen (nur aktueller Ausschnitt laden).

Als pragmatische Maßnahme: Falls Graph > 2000 Knoten, Warnung anzeigen und nur erste 2 Ebenen transient anzeigen, Rest als „…“-Cluster.

d) Dynamische/ Git-Abhängigkeiten
Beim Parsen erkennen wir Muster wie "package": "git+https://..." oder Pfad-Angaben.

Solche Abhängigkeiten werden als spezieller Knotentyp unmanaged markiert und erhalten keine transitive Auflösung.

Im Graphen werden sie z. B. mit gestrichelter Kante und Warn-Icon dargestellt. Der User kann sie anklicken und sieht die Zeile aus dem Manifest.

Später optional: Bei öffentlichen Git-Repos könnte man versuchen, dort ebenfalls eine package.json zu laden – aber das ist Phase X.

e) Fallback für private Pakete / nicht verfügbare Registry
Wenn fetchRegistryVersions für ein Paket keinen Eintrag liefert (404), wird das Paket als unresolved markiert.

Im Graph erscheint es mit Platzhalter-Version („unknown“) und roter Farbe. Der User kann es im Frontend manuell einer Version zuweisen (nur für Anzeige, keine Neuauflösung).

Phase 3: Sicherheitslücken & Lizenzkonflikte (2 Wochen)
Sicherheitslücken:

Nachdem der Graph steht, durchlaufen wir alle Paket-Knoten und rufen die OSV.dev-API auf: POST /v1/query mit Paket-Ökosystem, Name und Version.

Wegen Rate-Limiting: Batching (max 10 pro Request) und Caching (Redis, TTL 6h).

Für jedes gefundene Advisory speichern wir Schweregrad und URL → Node-Detail-Panel zeigt „Vulnerability: CVE-…” und Link.

Lizenzkonflikte:

Lizenz-Information ist oft in Registry-Metadaten enthalten (npm: license-Feld; PyPI: classifiers oder license).

Beim Auflösen speichern wir die Lizenz. Am Ende vergleichen wir mit einer konfigurierbaren Liste inkompatibler Lizenzen (z. B. GPL-3.0 in Kombination mit proprietär).

Bei Konflikt: Knoten mit Warnmarkierung, im Detail erklären.

Phase 4 (optional): Optimierungen und erweiterte Features
Benutzer-Accounts, Projekt-Historie.

Vergleich mehrerer Projekt-Snapshots.

Direkte Visualisierung des Lockfiles, falls vorhanden, mit Option manuelle Auflösung zu vergleichen.

CI-Integration (API-Schlüssel).

5. Code-Skizze: Graph-Konstruktion mit Konflikterkennung
typescript
interface ResolvedNode {
  key: string;               // z.B. "npm:lodash:4.17.21"
  ecosystem: string;
  name: string;
  version: string;
  sourceEdges: Edge[];       // wer zieht dieses Paket ein
}

function detectConflicts(graph: Map<string, ResolvedNode>) {
  const byName = new Map<string, ResolvedNode[]>();
  for (const node of graph.values()) {
    const nameKey = `${node.ecosystem}:${node.name}`;
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(node);
  }
  const conflicts = [];
  for (const [nameKey, nodes] of byName.entries()) {
    if (nodes.length > 1) {
      conflicts.push({ nameKey, versions: nodes.map(n => n.version) });
      // Markiere alle betroffenen Knoten und Kanten
      nodes.forEach(node => node.conflict = true);
      nodes.forEach(node =>
        node.sourceEdges.forEach(edge => edge.conflict = true)
      );
    }
  }
  return conflicts;
}
Im JSON für Cytoscape setzen wir dann data: { conflict: true } und nutzen CSS-Selektoren:

css
node[conflict] { border-color: red; border-width: 2px; }
edge[conflict] { line-color: red; }
6. Frontend-Architektur (React + Cytoscape)
Upload-Komponente: Drag&Drop oder URL-Feld. POST an /api/analyze, erhält graphJSON.

Graph-Darstellung: CytoscapeComponent (react-cytoscapejs) mit CoSE-Layout, Zoom, Pan.

Seitenleiste: Knoten-Details bei Klick: Name, Version, Quelle, Lizenz, Sicherheitslücken. Tabelle mit allen direkten Abhängigkeiten.

Filter/ Suche: Suchfeld, markiert Knoten; Checkbox „nur Konflikte zeigen“.

Export: Als PNG (cy.png()) oder JSON.

7. Ist ein MVP mit nur direkten Abhängigkeiten sinnvoll?
Ja, unbedingt. Das getrennte Vorgehen hat mehrere Vorteile:

Frühes Feedback: Benutzer sehen sofort, ob die Manifest-Erkennung und Parser funktionieren – noch bevor die komplexe Registry-Integration gebaut wird.

Risikominimierung: Die transitive Auflösung ist der schwierigste Teil (Rate-Limits, Versionsbereiche, private Pakete). Ein MVP ohne diese Baustelle liefert in 2–3 Wochen ein demonstrierbares Produkt.

Iterative Verbesserung: Nach Phase 1 kann man das Parser-Repertoire erweitern und anhand echter Projekte validieren, bevor man den Graphen exponentiell wachsen lässt.

Didaktischer Wert: Für dich als Entwickler ist es leichter, erst die Container-Logik (Scan, Parse, Graph-Ausgabe) zu beherrschen, dann die externen Abhängigkeiten.

Daher ist der Plan bewusst in eine MVP-Phase (direkt) und eine Vollversion (transitiv) unterteilt.
