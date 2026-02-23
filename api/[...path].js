const app = require('../server');

// Export the Express app as a Vercel serverless function handler
// Vercel expects a function signature (req, res), so delegate to the Express app.
module.exports = (req, res) => app(req, res);
