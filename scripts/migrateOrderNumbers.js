const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Order } = require('../models');

dotenv.config();

async function migrateOrders() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const orders = await Order.find({
            orderNumber: { $not: /^ORD\d{4}\d{3,}/ } // Find orders that don't match the new format
        }).sort({ createdAt: 1 });

        console.log(`Found ${orders.length} orders to migrate.`);

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            const date = order.createdAt || new Date();
            const year = date.getFullYear().toString().slice(-2);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const prefix = `ORD${year}${month}`;

            // Find the count of orders already migrated or existing in that same month/year
            // to determine the next sequence number for THIS SPECIFIC order based on its creation time.
            // This is slightly complex if we want to maintain chronological order in the sequence.
            // For simplicity, we can just use a counter for THIS script run if we assume we are migrating everything.
            // But better to be precise.

            const latestInMonth = await Order.findOne({
                orderNumber: new RegExp(`^${prefix}`)
            }).sort({ orderNumber: -1 }).select('orderNumber').lean();

            let sequence = 1;
            if (latestInMonth && latestInMonth.orderNumber.startsWith(prefix)) {
                const lastSeqStr = latestInMonth.orderNumber.substring(prefix.length);
                const lastSeq = parseInt(lastSeqStr, 10);
                if (!isNaN(lastSeq)) {
                    sequence = lastSeq + 1;
                }
            }

            const newOrderNumber = `${prefix}${sequence.toString().padStart(3, '0')}`;

            console.log(`Migrating ${order.orderNumber} -> ${newOrderNumber}`);

            order.orderNumber = newOrderNumber;
            await order.save();
        }

        console.log('Migration completed.');

    } catch (err) {
        console.error('Migration Error:', err);
    } finally {
        await mongoose.connection.close();
    }
}

migrateOrders();
