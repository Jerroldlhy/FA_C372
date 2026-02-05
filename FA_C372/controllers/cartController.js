const { getCourseById } = require("../models/courseModel");
const {
  addItemToCart,
  removeItemFromCart,
  getCartItemsForUser,
} = require("../models/cartModel");
const { isStudentEnrolled } = require("../models/enrollmentModel");
const {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  normaliseCurrency,
  convertAmount,
  getSymbol,
} = require("../services/currency");

const isPublishedCourse = (course) => course && course.is_active !== 0;

const showCart = async (req, res, next) => {
  try {
    const items = await getCartItemsForUser(req.user.id);
    const total = items.reduce((sum, item) => {
      return sum + Number(item.price || 0) * Number(item.quantity || 1);
    }, 0);
    const currency = normaliseCurrency(req.session?.currency || DEFAULT_CURRENCY);
    const convertedTotal = convertAmount(total, DEFAULT_CURRENCY, currency);
    res.render("cart", {
      items,
      total,
      currency,
      baseCurrency: DEFAULT_CURRENCY,
      supportedCurrencies: SUPPORTED_CURRENCIES,
      currencySymbol: getSymbol(currency),
      baseCurrencySymbol: getSymbol(DEFAULT_CURRENCY),
      convertedTotal,
      status: req.query,
      activePayment: req.session?.payment || null,
      paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    });
  } catch (err) {
    next(err);
  }
};

const addCourseToCart = async (req, res, next) => {
  try {
    const courseId = req.validated?.courseId || Number(req.params.id);
    const redirectToRaw = String(req.query.redirect_to || req.body?.redirect_to || "").trim();
    const redirectTo = redirectToRaw.startsWith("/") ? redirectToRaw : null;
    const redirectWithStatus = (statusKey, statusValue) => {
      if (!redirectTo) return null;
      const separator = redirectTo.includes("?") ? "&" : "?";
      return `${redirectTo}${separator}${encodeURIComponent(statusKey)}=${encodeURIComponent(statusValue)}`;
    };
    const course = await getCourseById(courseId);
    if (!course) return res.redirect(redirectWithStatus("cart_error", "course_missing") || "/courses?cart_error=course_missing");
    if (!isPublishedCourse(course)) {
      return res.redirect(redirectWithStatus("cart_error", "course_unpublished") || "/courses?cart_error=course_unpublished");
    }

    const enrolled = await isStudentEnrolled(courseId, req.user.id);
    if (enrolled) return res.redirect(redirectWithStatus("cart_error", "already_enrolled") || "/courses?cart_error=already_enrolled");

    await addItemToCart(req.user.id, courseId, 1);
    if (redirectTo) {
      return res.redirect(redirectWithStatus("cart_added", "1"));
    }
    return res.redirect("/courses?cart_added=1");
  } catch (err) {
    next(err);
  }
};

const removeCourseFromCart = async (req, res, next) => {
  try {
    const courseId = req.validated?.courseId || Number(req.params.id);
    await removeItemFromCart(req.user.id, courseId);
    res.redirect("/cart?removed=1");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  showCart,
  addCourseToCart,
  removeCourseFromCart,
};
