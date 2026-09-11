const express = require('express');
const path = require('path');
const api = require('./backend/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use('/api', api);

// Serve the built React app
app.use(express.static(path.join(__dirname, 'dist')));

// For SPA routing: always return index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GestionBar local server running on http://0.0.0.0:${PORT}`);
});
