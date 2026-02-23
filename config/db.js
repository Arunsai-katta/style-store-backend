const mongoose = require('mongoose');

// Cache the connection globally to share it between serverless function invocations
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
    if (cached.conn) {
        console.log('Using cached database connection');
        return cached.conn;
    }

    if (!cached.promise) {
        // Connect to database with specific options to fail fast if disconnected
        // bufferCommands: false ensures Mongoose throws an error rather than hanging 
        // when a command is executed without a connection
        const opts = {
            bufferCommands: false,
        };

        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
        console.log('Connecting to database...');

        cached.promise = mongoose.connect(uri, opts).then((mongoose) => {
            console.log('MongoDB successfully connected in serverless function');
            return mongoose;
        }).catch(error => {
            console.error('Error connecting to MongoDB:', error);
            cached.promise = null; // Reset promise so next request tries again
            throw error;
        });
    }

    cached.conn = await cached.promise;
    return cached.conn;
}

module.exports = connectDB;
