const app = require('../server');
const connectDB = require('../config/db');

// Export the Express app as a Vercel serverless function handler
module.exports = async (req, res) => {
    // Ensure the database is connected before handling the request
    try {
        await connectDB();
    } catch (error) {
        console.error('Database connection failed:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to connect to the database.'
        });
    }

    // Delegate to the standard Express application
    return app(req, res);
};
