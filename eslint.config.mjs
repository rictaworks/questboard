import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: ['app-ui/**', '.next/**', 'node_modules/**'],
  },
  ...(Array.isArray(nextVitals) ? nextVitals : [nextVitals]),
];

export default config;
