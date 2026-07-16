#!/usr/bin/env node

import Pastel from 'pastel';

const app = new Pastel({
  name: '100xsystems',
  description: 'CLI for 100xSystems — build real systems, take quizzes, and verify your implementations.',
  version: '0.1.0',
  importMeta: import.meta,
});

await app.run();
