const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Order } = require('../models');

dotenv.config();

async function testGeneration() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const expectedPrefix = `ORD${year}${month}`;

        console.log(`Expected Prefix: ${expectedPrefix}`);

        // Create a temporary order to test generation
        // We use a dummy user ID (must be a valid ObjectId)
        const dummyUserId = new mongoose.Types.ObjectId();

        console.log('Generating first test order...');
        const order1 = new Order({
            user: dummyUserId,
            items: [{
                product: new mongoose.Types.ObjectId(),
                name: 'Test Product',
                colorVariant: { colorName: 'Red', colorCode: '#FF0000', image: 'test.jpg' },
                size: 'M',
                quantity: 1,
                originalPrice: 100,
                sellingPrice: 100,
                totalPrice: 100
            }],
            shippingAddress: {
                name: 'Test',
                phone: '1234567890',
                addressLine1: 'Test',
                city: 'Test',
                state: 'Test',
                pincode: '123456'
            },
            payment: { method: 'cod' },
            pricing: { subtotal: 100, total: 100 }
        });

        // We only need to trigger validation
        await order1.validate();
        console.log(`Generated Order 1 Number: ${order1.orderNumber}`);

        if (order1.orderNumber.startsWith(expectedPrefix)) {
            console.log('SUCCESS: Order 1 format is correct.');
        } else {
            console.log('FAILURE: Order 1 format is incorrect.');
        }

        // To test incrementing, we would need to save it, but we don't want to pollute the DB.
        // However, the logic relies on finding the latest in the DB.
        // So for a real test, we should save and then delete.

        await order1.save();
        console.log('Order 1 saved.');

        console.log('Generating second test order...');
        const order2 = new Order({
            user: dummyUserId,
            items: order1.items,
            shippingAddress: order1.shippingAddress,
            payment: order1.payment,
            pricing: order1.pricing
        });

        await order2.validate();
        console.log(`Generated Order 2 Number: ${order2.orderNumber}`);

        const seq1 = parseInt(order1.orderNumber.substring(expectedPrefix.length));
        const seq2 = parseInt(order2.orderNumber.substring(expectedPrefix.length));

        if (seq2 === seq1 + 1) {
            console.log('SUCCESS: Order 2 incremented correctly.');
        } else {
            console.log('FAILURE: Order 2 did not increment correctly.');
        }

        // Cleanup
        await Order.findByIdAndDelete(order1._id);
        console.log('Test orders cleaned up.');

    } catch (err) {
        console.error('Test Error:', err);
    } finally {
        await mongoose.connection.close();
    }
}

testGeneration();
