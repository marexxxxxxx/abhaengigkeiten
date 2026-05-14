# Dependency Graph Visualizer

Ziel dieses Projekts ist eine Web-App, die per ZIP-Upload oder Repo-URL alle Abhängigkeiten eines Projekts erkennt, transitiv auflöst und als interaktiven Graphen visualisiert – inklusive Versionskonflikten, Sicherheitslücken und Lizenzkonflikten.

---

## Inhaltsverzeichnis
- [Überblick & Technologie-Stack](#überblick--technologie-stack)
- [Architektur](#architektur)
- [Automatische Erkennung der Paketmanager](#automatische-erkennung-der-paketmanager)
- [Roadmap & Fortschritt](#roadmap--fortschritt)
- [Frontend-Architektur](#frontend-architektur)
- [Warum ein MVP?](#warum-ein-mvp)

---

## Überblick & Technologie-Stack

**Empfohlener Stack:**
- **Frontend:** React + TypeScript + Cytoscape.js (Canvas-Rendering, performant für Graphen bis ~2000 Knoten)
- **Backend:** Node.js (Express) – eine einheitliche Sprache reduziert Kontextwechsel, und npm-Ökosystem-Bibliotheken sind direkt nutzbar.
- **Caching:** Redis (Persistenz und Shared Cache bei Skalierung) oder für die erste Version `lru-cache` im Speicher.
- **Parsing:** Pro Ökosystem eine kleine Adapter-Funktion; existierende Parser-Bibliotheken wo sinnvoll.
- **Registry-APIs:** npm, PyPI, crates.io, Maven Central, Go-Proxy usw.

---

## Architektur

### Datenfluss
```text
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
```

1. Benutzer lädt ZIP hoch oder gibt URL ein → Backend lädt Projekt in temporäres Verzeichnis.
2. Scan-Modul traversiert alle Dateien und prüft gegen eine vordefinierte Liste von Manifest-Dateinamen.
3. Für jedes erkannte Manifest wird der zugehörige Parser geladen und die direkten Abhängigkeiten extrahiert.
4. Ein rekursiver BFS-Resolver fragt Registry-APIs ab (mit Caching) und baut einen gemeinsamen Graphen auf.
5. Der Graph wird aufbereitet (Knoten, Kanten, Konflikt-Markierungen) und an das Frontend gesendet.
6. Optional werden Sicherheitslücken und Lizenzdaten angereichert.

---

## Automatische Erkennung der Paketmanager

Wir verwenden eine Datei-nach-Parser-Map. Jeder Eintrag enthält:
- `filename`: z. B. `package.json`, `requirements.txt`, `Cargo.toml`
- `ecosystem`: String-Identifier (npm, pypi, cargo, maven, go, bundler, composer, nuget)
- `parser`: Funktion `(content: string) => Dep[]`
- `resolverStrategy`: Verweis auf den Resolver-Typ (für spätere Registry-Phase)

**Beispiel-Registry (vereinfacht):**
```typescript
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
  'requirements.txt': { /* PyPI Parser */ },
  'Cargo.toml': { /* Cargo Parser */ },
  'pom.xml': { /* Maven Parser */ }
};
```

---

## Roadmap & Fortschritt

- [x] **Phase 1: MVP – Nur direkte Abhängigkeiten visualisieren**
  - **Ziel:** Upload/URL, Manifest-Scan, Parsen, einfacher Graph (keine transitive Auflösung, keine Konflikterkennung). Damit validieren wir UI und Konzept.
  - **Status:** *Implementiert (Express-Backend, React-Frontend, Cytoscape-Graph)*
- [-] **Phase 2: Transitive Auflösung & Versionskonflikte**
  - Registry-Abfragen, rekursive Dependency-Auflösung (BFS), Konflikt-Highlighting, Umgang mit großen Graphen.
  - Erkennen, wenn Pakete unterschiedliche Versionen eines Unter-Pakets benötigen (Sub-Dependency-Konflikt).
- [ ] **Phase 3: Sicherheitslücken & Lizenzkonflikte**
  - Abfrage der OSV.dev-API für Vulnerabilities, Lizenz-Check.
- [ ] **Phase 4: Optimierungen (optional)**
  - Benutzer-Accounts, Projekt-Historie, Vergleich von Snapshots, CI-Integration.

---

## Frontend-Architektur (React + Cytoscape)
- **Upload-Komponente:** Drag&Drop oder URL-Feld. POST an `/api/analyze`, erhält `graphJSON`.
- **Graph-Darstellung:** `CytoscapeComponent` (`react-cytoscapejs`) mit CoSE-Layout, Zoom, Pan.
- **Seitenleiste:** Knoten-Details bei Klick (Name, Version, Quelle, Lizenz, Sicherheitslücken). Tabelle mit allen direkten Abhängigkeiten.
- **Filter/ Suche:** Suchfeld, markiert Knoten; Checkbox „nur Konflikte zeigen“.
- **Export:** Als PNG (`cy.png()`) oder JSON.

---

## Warum ein MVP?

Das getrennte Vorgehen (zuerst MVP, dann Vollversion) hat mehrere Vorteile:
- **Frühes Feedback:** Benutzer sehen sofort, ob die Manifest-Erkennung und Parser funktionieren.
- **Risikominimierung:** Die transitive Auflösung ist der schwierigste Teil. Ein MVP liefert schnell ein demonstrierbares Produkt.
- **Iterative Verbesserung:** Nach Phase 1 kann das Parser-Repertoire erweitert und anhand echter Projekte validiert werden.
