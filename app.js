const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const multer = require('multer');
require('dotenv').config();
const app = express();

const userController = require('./controllers/UserController');
const cartController = require('./controllers/CartController');
const productController = require('./controllers/ProductController');
const orderController = require('./controllers/OrderController');
const reviewController = require('./controllers/ReviewController');
const netsController = require('./controllers/netsController');
const refundController = require('./controllers/RefundController');
const adminRefundController = require('./controllers/AdminRefundController');
const subscriptionController = require('./controllers/SubscriptionController');
const reportController = require('./controllers/ReportController');
const { checkAuthenticated, checkAdmin, checkRoles } = require('./middleware');
const { createOrder, captureOrder } = require('./services/paypal');
const { createCheckoutSession, retrieveCheckoutSession } = require('./services/stripe');
const Order = require('./models/order');
const PaymentAttempt = require('./models/paymentAttempt');
const { withRetries } = require('./services/retry');
const fraudService = require('./services/fraud');
const { DEFAULT_CURRENCY, normaliseCurrency, convertAmount, getExchangeRate } = require('./services/currency');
const subscriptionService = require('./services/subscriptionService');
const Notifications = require('./services/notifications');

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Set up view engine
app.set('view engine', 'ejs');
// Enable static files
app.use(express.static('public'));
// Enable form processing
app.use(express.urlencoded({
    extended: false
}));
app.use(express.json());

// Session Middleware stored in MySQL so sessions persist across browsers/devices
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    createDatabaseTable: true
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

// Expose session user and flash feedback to all templates
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.messages = req.flash('success');
    res.locals.errors = req.flash('error');
    res.locals.formData = req.flash('formData')[0] || null;
    next();
});

// Routes
app.get('/', (req, res) => {
    res.render('index', {user: req.session.user});
});

app.get('/inventory', checkAuthenticated, checkAdmin, productController.showInventory);

app.get('/register', userController.showRegister);
app.post('/register', userController.register);

app.get('/login', userController.showLogin);
app.post('/login', userController.login);
app.get('/login/2fa', userController.showLogin2FA);
app.post('/login/2fa', userController.verifyLogin2FA);

app.get('/2fa/setup', checkAuthenticated, userController.show2FASetup);
app.post('/2fa/verify-setup', checkAuthenticated, userController.verify2FASetup);

app.get('/admin/users', checkAuthenticated, checkAdmin, userController.listUsers);
app.get('/admin/users/:id/edit', checkAuthenticated, checkAdmin, userController.editUserForm);
app.post('/admin/users/:id', checkAuthenticated, checkAdmin, userController.updateUserRole);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, userController.deleteUser);
app.post('/admin/users/:id/disable-2fa', checkAuthenticated, checkAdmin, userController.disableTwoFactor);

app.get('/shopping', checkAuthenticated, checkRoles('user'), productController.showShopping);

app.post('/add-to-cart/:id', checkAuthenticated, checkRoles('user'), cartController.addToCart);
app.get('/cart', checkAuthenticated, checkRoles('user'), cartController.viewCart);
app.post('/cart/update/:id', checkAuthenticated, checkRoles('user'), cartController.updateCartItem);
app.post('/cart/remove/:id', checkAuthenticated, checkRoles('user'), cartController.removeCartItem);
app.post('/checkout', checkAuthenticated, checkRoles('user'), orderController.startCheckout);
app.get('/cart/payment', checkAuthenticated, checkRoles('user'), orderController.payment);
app.post('/cart/payment/currency', checkAuthenticated, checkRoles('user'), orderController.setCurrency);
app.get('/cart/checkout', checkAuthenticated, checkRoles('user'), orderController.checkout);
app.post('/nets-qr/request', checkAuthenticated, checkRoles('user'), netsController.requestQr);
app.get('/nets-qr/success', checkAuthenticated, checkRoles('user'), netsController.success);
app.get('/nets-qr/fail', checkAuthenticated, checkRoles('user'), netsController.fail);
app.get('/sse/payment-status/:txnRetrievalRef', checkAuthenticated, checkRoles('user'), netsController.streamStatus);
app.get('/orders/history', checkAuthenticated, checkRoles('user'), orderController.history);
app.get('/orders/:id/print', checkAuthenticated, orderController.printOrder);
app.post('/orders/:id/delivery', checkAuthenticated, orderController.updateDeliveryDetails);
app.post('/orders/:id/confirm-delivery', checkAuthenticated, checkRoles('user'), orderController.confirmDelivery);
app.post('/orders/:id/retry-payment', checkAuthenticated, checkRoles('user'), orderController.retryPayment);
app.post('/admin/orders/:id/tracking', checkAuthenticated, checkAdmin, orderController.addTracking);
app.get('/refunds', checkAuthenticated, checkRoles('user'), refundController.list);
app.get('/refunds/request/:orderId', checkAuthenticated, checkRoles('user'), refundController.showRequestForm);
app.post('/refunds/request/:orderId', checkAuthenticated, checkRoles('user'), refundController.submitRequest);
app.get('/refunds/:id', checkAuthenticated, checkRoles('user'), refundController.details);

app.get('/logout', userController.logout);

app.get('/product/:id', checkAuthenticated, productController.showProductDetails);
app.post('/product/:id/reviews', checkAuthenticated, checkRoles('user'), reviewController.upsert);
app.post('/product/:id/reviews/:reviewId/delete', checkAuthenticated, checkRoles('user'), reviewController.remove);

app.get('/addProduct', checkAuthenticated, checkAdmin, productController.showAddProductForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.addProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.showUpdateProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.updateProduct);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.deleteProduct);
app.get('/admin/deliveries', checkAuthenticated, checkAdmin, orderController.listAllDeliveries);
app.get('/admin/refunds', checkAuthenticated, checkAdmin, adminRefundController.list);
app.get('/admin/refunds/:id', checkAuthenticated, checkAdmin, adminRefundController.details);
app.post('/admin/refunds/:id/approve', checkAuthenticated, checkAdmin, adminRefundController.approve);
app.post('/admin/refunds/:id/reject', checkAuthenticated, checkAdmin, adminRefundController.reject);
app.get('/admin/reports/payments', checkAuthenticated, checkAdmin, reportController.paymentsReport);
app.post('/admin/reports/payments/fraud-test', checkAuthenticated, checkAdmin, (req, res) => {
    fraudService.assessPaymentAttempt(req, null, (err, result) => {
        if (err) {
            console.error('Fraud test failed:', err);
            req.flash('error', 'Fraud test failed.');
            return res.redirect('/admin/reports/payments');
        }

        const flags = result.flags && result.flags.length ? result.flags.join(', ') : 'none';
        req.flash('success', `Fraud test: action=${result.action}, risk=${result.riskScore}, flags=${flags}`);
        return res.redirect('/admin/reports/payments');
    });
});

app.get('/api/subscriptions', checkAuthenticated, subscriptionController.list);
app.post('/api/subscriptions', checkAuthenticated, subscriptionController.create);

app.post('/api/paypal/create-order', checkAuthenticated, checkRoles('user'), async (req, res) => {
    try {
        const pendingOrderId = req.session.pendingOrderId;
        if (!pendingOrderId) {
            return res.status(400).json({ error: 'No pending order found.' });
        }

        const orderRow = await new Promise((resolve, reject) => {
            Order.findById(pendingOrderId, (err, rows) => {
                if (err) return reject(err);
                return resolve(rows && rows[0] ? rows[0] : null);
            });
        });

        if (!orderRow) {
            return res.status(400).json({ error: 'Pending order not found.' });
        }

        const currency = normaliseCurrency(req.session.currency || DEFAULT_CURRENCY);
        const method = typeof req.body.method === 'string' ? req.body.method : 'paypal';
        const exchangeRate = getExchangeRate(DEFAULT_CURRENCY, currency);
        const amount = convertAmount(orderRow.total, DEFAULT_CURRENCY, currency).toFixed(2);

        const fraudCheck = await new Promise((resolve, reject) => {
            fraudService.assessPaymentAttempt(req, req.session.user.id, { amount }, (err, result) => {
                if (err) {
                    return reject(err);
                }
                return resolve(result);
            });
        });

        if (fraudCheck.action === 'block') {
            return res.status(429).json({ error: 'Payment blocked due to risk checks.' });
        }

        const order = await withRetries(
            () => createOrder(amount, { currencyCode: currency, invoiceNumber: orderRow.invoice_number }),
            { retries: 2, baseDelayMs: 250 }
        );

        PaymentAttempt.create({
            userId: req.session.user.id,
            orderId: pendingOrderId,
            provider: 'paypal',
            method,
            status: 'INITIATED',
            amount,
            currency,
            ipAddress: fraudCheck.ipAddress,
            providerOrderId: order.id
        }, () => {});

        return res.json(order);
    } catch (err) {
        console.error('PayPal create order error:', err);
        return res.status(500).json({ error: 'Failed to create PayPal order' });
    }
});

app.post('/api/paypal/capture-order', checkAuthenticated, checkRoles('user'), async (req, res) => {
    try {
        const { orderId, method } = req.body;
        const capture = await withRetries(
            () => captureOrder(orderId),
            { retries: 2, baseDelayMs: 300 }
        );
        const payments = capture
            && capture.purchase_units
            && capture.purchase_units[0]
            && capture.purchase_units[0].payments;

        const captureId = payments
            && payments.captures
            && payments.captures[0]
            && payments.captures[0].id;

        const authorizationId = payments
            && payments.authorizations
            && payments.authorizations[0]
            && payments.authorizations[0].id;

        if (!capture || capture.status !== 'COMPLETED') {
            PaymentAttempt.updateStatusByProviderOrder(orderId, 'FAILED', 'Capture not completed', () => {});
            return res.status(400).json({ error: 'Payment capture not completed.' });
        }

        const paymentId = captureId || authorizationId || null;
        if (!paymentId) {
            PaymentAttempt.updateStatusByProviderOrder(orderId, 'FAILED', 'Missing capture ID', () => {});
            return res.status(400).json({ error: 'Payment capture incomplete.' });
        }

        const paymentMethod = typeof method === 'string' ? method : 'paypal';
        req.session.payment = { method: paymentMethod, captureId: paymentId };
        PaymentAttempt.updateStatusByProviderOrder(orderId, 'SUCCEEDED', null, () => {});
        return res.json(capture);
    } catch (err) {
        console.error('PayPal capture error:', err);
        PaymentAttempt.updateStatusByProviderOrder(req.body.orderId, 'FAILED', err.message || 'Capture failed', () => {});
        if (req.session && req.session.pendingOrderId) {
            Order.incrementPaymentAttempts(req.session.pendingOrderId, err.message || 'Capture failed', () => {});
            Order.findById(req.session.pendingOrderId, (findErr, rows) => {
                if (!findErr && rows && rows[0]) {
                    Notifications.sendPaymentUpdate(req.session.user, rows[0], 'failed');
                }
            });
        }
        return res.status(500).json({ error: 'Failed to capture PayPal order' });
    }
});

app.post('/api/stripe/create-checkout-session', checkAuthenticated, checkRoles('user'), async (req, res) => {
    try {
        const pendingOrderId = req.session.pendingOrderId;
        if (!pendingOrderId) {
            return res.status(400).json({ error: 'No pending order found.' });
        }

        const orderRow = await new Promise((resolve, reject) => {
            Order.findById(pendingOrderId, (err, rows) => {
                if (err) return reject(err);
                return resolve(rows && rows[0] ? rows[0] : null);
            });
        });

        if (!orderRow) {
            return res.status(400).json({ error: 'Pending order not found.' });
        }

        const currency = normaliseCurrency(req.session.currency || DEFAULT_CURRENCY);
        const amount = convertAmount(orderRow.total, DEFAULT_CURRENCY, currency).toFixed(2);
        const host = `${req.protocol}://${req.get('host')}`;

        const fraudCheck = await new Promise((resolve, reject) => {
            fraudService.assessPaymentAttempt(req, req.session.user.id, { amount }, (err, result) => {
                if (err) {
                    return reject(err);
                }
                return resolve(result);
            });
        });

        if (fraudCheck.action === 'block') {
            return res.status(429).json({ error: 'Payment blocked due to risk checks.' });
        }

        const session = await createCheckoutSession({
            amount,
            currency,
            description: `Order #${orderRow.id}`,
            successUrl: `${host}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${host}/stripe/cancel`,
            metadata: {
                orderId: String(orderRow.id)
            },
            customerEmail: req.session.user && req.session.user.email ? req.session.user.email : undefined,
            clientReferenceId: String(orderRow.id)
        });

        PaymentAttempt.create({
            userId: req.session.user.id,
            orderId: pendingOrderId,
            provider: 'stripe',
            method: 'card',
            status: 'INITIATED',
            amount,
            currency,
            ipAddress: fraudCheck.ipAddress,
            providerOrderId: session.id
        }, () => {});

        return res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe checkout session error:', err);
        return res.status(500).json({ error: 'Failed to create Stripe checkout session.' });
    }
});

app.get('/stripe/success', checkAuthenticated, checkRoles('user'), async (req, res) => {
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId) {
        req.flash('error', 'Stripe session not found.');
        return res.redirect('/cart/payment');
    }

    try {
        const session = await retrieveCheckoutSession(sessionId);
        const paymentStatus = String(session.payment_status || '').toLowerCase();
        const isPaid = paymentStatus === 'paid' || session.status === 'complete';

        if (!isPaid) {
            PaymentAttempt.updateStatusByProviderOrder(sessionId, 'FAILED', 'Stripe payment not completed', () => {});
            req.flash('error', 'Stripe payment was not completed.');
            return res.redirect('/cart/payment');
        }

        const paymentIntentId = session.payment_intent ? String(session.payment_intent) : sessionId;
        req.session.payment = { method: 'stripe', captureId: paymentIntentId };
        PaymentAttempt.updateStatusByProviderOrder(sessionId, 'SUCCEEDED', null, () => {});
        return req.session.save(() => res.redirect('/cart/checkout'));
    } catch (err) {
        console.error('Stripe success verify error:', err);
        PaymentAttempt.updateStatusByProviderOrder(sessionId, 'FAILED', err.message || 'Stripe verification failed', () => {});
        req.flash('error', 'Stripe verification failed.');
        return res.redirect('/cart/payment');
    }
});

app.get('/stripe/cancel', checkAuthenticated, checkRoles('user'), (req, res) => {
    req.flash('error', 'Stripe payment cancelled.');
    return res.redirect('/cart/payment');
});

app.post('/api/payments/mark-failed', checkAuthenticated, checkRoles('user'), orderController.markPaymentFailed);

// Friendly 404 page
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page not found',
        statusCode: 404,
        message: "We couldn't find that page.",
        actions: [
            { label: 'Go to Home', href: '/' },
            { label: 'Browse Products', href: '/shopping' }
        ]
    });
});

// Friendly error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    const statusCode = err.status || 500;
    res.status(statusCode).render('error', {
        title: statusCode === 404 ? 'Page not found' : 'Something went wrong',
        statusCode,
        message: statusCode === 404
            ? "We couldn't find that page."
            : 'Please try again in a moment.',
        actions: [
            { label: 'Go to Home', href: '/' },
            { label: 'Back to Login', href: '/login' }
        ],
        details: process.env.NODE_ENV === 'development' ? err.message : null
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

setInterval(subscriptionService.processDueSubscriptions, 30 * 60 * 1000);
