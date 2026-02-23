/**
 * Razorpay Payout Service
 * Used to refund COD orders by sending money directly to customer's UPI/bank.
 * Requires a Razorpay X account. Add to .env:
 *   RAZORPAY_X_ACCOUNT_NUMBER=<your_razorpay_x_account_number>
 *   RAZORPAY_KEY_ID=<your_key>
 *   RAZORPAY_KEY_SECRET=<your_secret>
 */

const axios = require('axios');

const PAYOUT_BASE_URL = 'https://api.razorpay.com/v1';

const getAuth = () => ({
    username: process.env.RAZORPAY_KEY_ID,
    password: process.env.RAZORPAY_KEY_SECRET,
});

// ---------------------------------------------------------------------------
// Mock mode — same RAZORPAY_MOCK or SHIPROCKET_MOCK flag for now.
// You can also create a separate PAYOUT_MOCK=true env var.
// ---------------------------------------------------------------------------
const isMock = () =>
    process.env.RAZORPAY_MOCK === 'true' || process.env.SHIPROCKET_MOCK === 'true';

// ---------------------------------------------------------------------------
// Create a Contact (customer) in Razorpay
// ---------------------------------------------------------------------------
exports.createContact = async ({ name, email, phone, reference }) => {
    if (isMock()) {
        return { id: `cont_MOCK${Date.now()}`, name };
    }
    const { data } = await axios.post(
        `${PAYOUT_BASE_URL}/contacts`,
        { name, email, contact: phone, type: 'customer', reference_id: reference },
        { auth: getAuth() }
    );
    return data;
};

// ---------------------------------------------------------------------------
// Create a Fund Account (UPI or bank) for a contact
// ---------------------------------------------------------------------------
exports.createFundAccount = async ({ contactId, upiId, bankDetails }) => {
    if (isMock()) {
        return { id: `fa_MOCK${Date.now()}` };
    }

    let payload;
    if (upiId) {
        payload = {
            contact_id: contactId,
            account_type: 'vpa',
            vpa: { address: upiId },
        };
    } else {
        payload = {
            contact_id: contactId,
            account_type: 'bank_account',
            bank_account: {
                name: bankDetails.accountHolderName,
                ifsc: bankDetails.ifscCode,
                account_number: bankDetails.accountNumber,
            },
        };
    }

    const { data } = await axios.post(`${PAYOUT_BASE_URL}/fund_accounts`, payload, {
        auth: getAuth(),
    });
    return data;
};

// ---------------------------------------------------------------------------
// Create a Payout (send money to the fund account)
// ---------------------------------------------------------------------------
exports.createPayout = async ({ fundAccountId, amount, currency = 'INR', reference, narration }) => {
    if (isMock()) {
        const id = `pout_MOCK${Date.now()}`;
        console.log(`[Payout MOCK] createPayout — ₹${amount} to fund account ${fundAccountId} — id: ${id}`);
        return { id, status: 'processing', utr: `UTR${Date.now()}` };
    }

    const accountNumber = process.env.RAZORPAY_X_ACCOUNT_NUMBER;
    if (!accountNumber) throw new Error('RAZORPAY_X_ACCOUNT_NUMBER is not configured');

    const { data } = await axios.post(
        `${PAYOUT_BASE_URL}/payouts`,
        {
            account_number: accountNumber,
            fund_account_id: fundAccountId,
            amount: Math.round(amount * 100), // paise
            currency,
            mode: 'UPI',
            purpose: 'refund',
            reference_id: reference,
            narration: narration || 'Order Refund',
            queue_if_low_balance: true,
        },
        { auth: getAuth() }
    );
    return data;
};

// ---------------------------------------------------------------------------
// Get Payout status
// ---------------------------------------------------------------------------
exports.getPayoutStatus = async (payoutId) => {
    if (isMock()) {
        return { id: payoutId, status: 'processed', utr: `UTR${Date.now()}` };
    }
    const { data } = await axios.get(`${PAYOUT_BASE_URL}/payouts/${payoutId}`, {
        auth: getAuth(),
    });
    return data;
};
