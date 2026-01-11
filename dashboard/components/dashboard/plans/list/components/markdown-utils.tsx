'use client';

import React from 'react';
import type { Components } from 'react-markdown';

// Helper to extract text from React children
export function getTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(getTextContent).join('');
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return getTextContent(props.children);
  }
  return '';
}

// Strip {#id} syntax and return clean text + id
export function parseHeading(children: React.ReactNode): { text: string; id?: string } {
  const text = getTextContent(children);
  const match = text.match(/^(.+?)\s*\{#([\w.-]+)\}$/);
  if (match) {
    return { text: match[1], id: match[2] };
  }
  return { text };
}

// Custom markdown components to handle anchor syntax {#id} and anchor links
export const markdownComponents: Components = {
  h1: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h1 id={id} {...props}>{text}</h1>;
  },
  h2: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h2 id={id} {...props}>{text}</h2>;
  },
  h3: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h3 id={id} {...props}>{text}</h3>;
  },
  h4: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h4 id={id} {...props}>{text}</h4>;
  },
  // Handle anchor links - scroll within container
  a: ({ href, children, ...props }) => {
    if (href?.startsWith('#')) {
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            const id = href.slice(1);
            const element = document.getElementById(id);
            element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          {...props}
        >
          {children}
        </a>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
};
