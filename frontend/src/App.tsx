import React, { useState } from 'react';
import axios from 'axios';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';

// Definieren von Typen für Cytoscape
interface ElementData {
  id: string;
  label?: string;
  source?: string;
  target?: string;
  [key: string]: any;
}

interface CyElement {
  data: ElementData;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [elements, setElements] = useState<CyElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<ElementData | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);
    setElements([]);
    setSelectedNode(null);

    const formData = new FormData();
    formData.append('project', file);

    try {
      const response = await axios.post('http://localhost:3001/api/analyze', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const { nodes, edges } = response.data;
      setElements([...nodes, ...edges]);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Error processing the project.');
    } finally {
      setLoading(false);
    }
  };

  const layout = {
    name: 'cose',
    animate: true,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{ padding: '20px', backgroundColor: '#282c34', color: 'white' }}>
        <h1>Dependency Graph Visualizer</h1>
        <div style={{ marginTop: '10px' }}>
          <input type="file" accept=".zip" onChange={handleFileChange} />
          <button onClick={handleUpload} disabled={!file || loading} style={{ marginLeft: '10px' }}>
            {loading ? 'Analyzing...' : 'Upload & Analyze'}
          </button>
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main Graph Area */}
        <div style={{ flex: 1, borderRight: '1px solid #ccc', position: 'relative' }}>
          {elements.length > 0 ? (
            <CytoscapeComponent
              elements={elements}
              style={{ width: '100%', height: '100%' }}
              layout={layout}
              stylesheet={[
                {
                  selector: 'node',
                  style: {
                    label: 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'background-color': '#0074D9',
                    color: '#fff',
                    'text-outline-color': '#0074D9',
                    'text-outline-width': 2,
                    width: '60px',
                    height: '60px',
                  },
                },
                {
                  selector: 'edge',
                  style: {
                    width: 2,
                    'line-color': '#999',
                    'target-arrow-color': '#999',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                  },
                },
              ]}
              cy={(cy: cytoscape.Core) => {
                cy.on('tap', 'node', (evt) => {
                  const node = evt.target;
                  setSelectedNode(node.data());
                });
              }}
            />
          ) : (
            <div style={{ padding: '20px', color: '#666' }}>
              <p>Upload a zipped project repository to see its dependency graph.</p>
              <p>Supports `package.json` and `requirements.txt` for now.</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: '300px', padding: '20px', backgroundColor: '#f4f4f4', overflowY: 'auto' }}>
          <h2>Details</h2>
          {selectedNode ? (
            <div>
              <p><strong>Name:</strong> {selectedNode.label || selectedNode.id}</p>
              {selectedNode.version && <p><strong>Version:</strong> {selectedNode.version}</p>}
              {selectedNode.type && <p><strong>Ecosystem:</strong> {selectedNode.type}</p>}
              {selectedNode.source && <p><strong>Source File:</strong> {selectedNode.source}</p>}
            </div>
          ) : (
            <p style={{ color: '#888' }}>Click on a node to view details.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
