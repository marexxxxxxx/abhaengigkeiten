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
  const layoutInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Disabling animate globally in layout option to prevent notify errors on fast refreshes
    const safeLayout = layout ? { ...layout, animate: false } : undefined;

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      elements: JSON.parse(JSON.stringify(elements)),
      style: stylesheet,
      layout: safeLayout,
    });

    cyInstanceRef.current = cy;

    if (cyRefCallback) {
      cyRefCallback(cy);
    }

    return () => {
      if (layoutInstanceRef.current) {
        layoutInstanceRef.current.stop();
        layoutInstanceRef.current = null;
      }
      if (cyInstanceRef.current) {
        cyInstanceRef.current.stop(true, true);
        cyInstanceRef.current.destroy();
        cyInstanceRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Update elements, layout, stylesheet if they change
  useEffect(() => {
    const cy = cyInstanceRef.current;
    if (cy && !cy.destroyed()) {
      cy.stop(true, true);
      if (layoutInstanceRef.current) {
        layoutInstanceRef.current.stop();
        layoutInstanceRef.current = null;
      }

      cy.json({ elements: JSON.parse(JSON.stringify(elements)), style: stylesheet });

      if (layout) {
        layoutInstanceRef.current = cy.layout({ ...layout, animate: false });
        layoutInstanceRef.current.run();
      }
    }
  }, [elements, stylesheet, layout]);

  return <div ref={containerRef} style={style} />;
};

export default CytoscapeComponent;
