import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

interface CytoscapeComponentProps {
  elements: any[];
  style?: React.CSSProperties;
  layout?: any;
  stylesheet?: any[];
  cy?: (cyInstance: cytoscape.Core) => void;
}

const CytoscapeComponent: React.FC<CytoscapeComponentProps> = ({
  elements,
  style,
  layout,
  stylesheet,
  cy: cyRefCallback,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyInstanceRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: stylesheet,
      layout,
    });

    cyInstanceRef.current = cy;

    if (cyRefCallback) {
      cyRefCallback(cy);
    }

    return () => {
      if (cyInstanceRef.current) {
        cyInstanceRef.current.destroy();
        cyInstanceRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Update elements, layout, stylesheet if they change
  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy) {
      cy.json({ elements, style: stylesheet });
      if (layout) {
        cy.layout(layout).run();
      }
    }
  }, [elements, stylesheet, layout]);

  return <div ref={containerRef} style={style} />;
};

export default CytoscapeComponent;
