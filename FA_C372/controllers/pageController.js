const { getCoursesWithStats, getCoursesForInstructors, getInstructorStats } = require("../models/courseModel");
const { getLecturers } = require("../models/userModel");
const { getReviewsForCourses } = require("../models/reviewModel");
const {
  getSubscriptionByUser,
  upsertSubscription,
  updateSubscriptionByStripeId,
  cancelSubscriptionByUser,
} = require("../models/subscriptionModel");
const { logUserActivity } = require("../models/userActivityModel");
const {
  createSubscriptionCheckoutSession,
  retrieveCheckoutSession,
  cancelSubscription,
  constructWebhookEvent,
} = require("../services/stripe");

const home = async (req, res, next) => {
  try {
    const courses = await getCoursesWithStats();
    res.render("index", { courses });
  } catch (err) {
    next(err);
  }
};

const PLAN_CATALOG = {
  free: {
    code: "free",
    name: "Free",
    price: 0,
    description: "Access free lessons and community forums.",
    perks: ["Access to free courses", "Community support", "Limited downloads", "Basic certificates"],
    cta: "Get Started",
  },
  pro: {
    code: "pro",
    name: "Pro",
    price: 29,
    description: "Unlimited learning, projects, and certificates.",
    perks: ["Unlimited course access", "Downloadable resources", "Project reviews", "Priority support", "Official certificates"],
    cta: "Subscribe with Stripe",
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "Team analytics and dedicated success manager.",
    perks: ["Team analytics", "Dedicated success manager", "Custom learning paths", "API access"],
    cta: "Contact Sales",
  },
};

const plans = async (req, res, next) => {
  try {
    const plans = [PLAN_CATALOG.free, PLAN_CATALOG.pro, PLAN_CATALOG.enterprise];
    let currentSubscription = null;
    let nextBillingDate = null;
    if (req.user?.id) {
      currentSubscription = await getSubscriptionByUser(req.user.id);
      if (currentSubscription && String(currentSubscription.status).toLowerCase() === "active") {
        const base = new Date(currentSubscription.starts_at);
        if (!Number.isNaN(base.getTime())) {
          const next = new Date(base);
          const now = new Date();
          while (next <= now) {
            next.setMonth(next.getMonth() + 1);
          }
          nextBillingDate = next;
        }
      }
    }
    res.render("plans", { plans, currentSubscription, nextBillingDate, status: req.query });
  } catch (err) {
    next(err);
  }
};

const subscribePlan = async (req, res, next) => {
  try {
    const planCode = String(req.body.plan_code || "").toLowerCase();
    const plan = PLAN_CATALOG[planCode];
    if (!plan) return res.redirect("/plans?subscription_error=invalid_plan");
    if (!req.user?.id) return res.redirect("/login");

    if (plan.code === "pro") {
      const priceId = String(process.env.STRIPE_PRO_PRICE_ID || "").trim();
      if (!priceId) {
        return res.redirect("/plans?subscription_error=stripe_price_missing");
      }
      const host = `${req.protocol}://${req.get("host")}`;
      const session = await createSubscriptionCheckoutSession({
        priceId,
        successUrl: `${host}/plans/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${host}/plans?subscription_error=stripe_cancelled`,
        customerEmail: req.user.email || undefined,
        clientReferenceId: String(req.user.id),
        metadata: { userId: String(req.user.id), planCode: plan.code },
      });
      return res.redirect(session.url);
    }

    const status = plan.code === "enterprise" ? "pending_contact" : "active";
    const monthlyPrice = typeof plan.price === "number" ? plan.price : 0;

    await upsertSubscription({
      userId: req.user.id,
      planCode: plan.code,
      planName: plan.name,
      monthlyPrice,
      status,
      startsAt: new Date(),
    });
    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "plan_subscribed",
      ipAddress: req.ip,
      details: { planCode: plan.code, status },
    });

    return res.redirect(`/plans?subscription_success=1&plan=${encodeURIComponent(plan.code)}`);
  } catch (err) {
    if (String(req.body?.plan_code || "").toLowerCase() === "pro") {
      return res.redirect("/plans?subscription_error=stripe_checkout_failed");
    }
    next(err);
  }
};

const stripeSubscribeSuccess = async (req, res, next) => {
  try {
    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) return res.redirect("/plans?subscription_error=stripe_session_missing");

    const session = await retrieveCheckoutSession(sessionId, { expand: ["subscription"] });
    const complete =
      String(session.status || "").toLowerCase() === "complete" &&
      String(session.mode || "").toLowerCase() === "subscription";
    if (!complete || !session.subscription) {
      return res.redirect("/plans?subscription_error=stripe_incomplete");
    }

    const userId = Number(session.client_reference_id || session.metadata?.userId || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.redirect("/plans?subscription_error=stripe_incomplete");
    }

    await upsertSubscription({
      userId,
      planCode: PLAN_CATALOG.pro.code,
      planName: PLAN_CATALOG.pro.name,
      monthlyPrice: Number(PLAN_CATALOG.pro.price) || 0,
      status: "active",
      stripeCustomerId: session.customer ? String(session.customer) : null,
      stripeSubscriptionId:
        typeof session.subscription === "string"
          ? session.subscription
          : String(session.subscription.id || ""),
      startsAt: new Date(),
    });

    await logUserActivity({
      userId,
      actorUserId: req.user?.id || userId,
      activityType: "plan_subscribed",
      ipAddress: req.ip,
      details: { planCode: "pro", status: "active", provider: "stripe" },
    });

    return res.redirect("/plans?subscription_success=1&plan=pro");
  } catch (err) {
    return next(err);
  }
};

const cancelPlan = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.redirect("/login");
    const currentSubscription = await getSubscriptionByUser(req.user.id);
    if (!currentSubscription) {
      return res.redirect("/plans?subscription_error=no_subscription");
    }
    if (String(currentSubscription.status || "").toLowerCase() === "cancelled") {
      return res.redirect("/plans?subscription_error=already_cancelled");
    }

    if (currentSubscription.plan_code === "pro" && currentSubscription.stripe_subscription_id) {
      await cancelSubscription(currentSubscription.stripe_subscription_id);
    }

    const cancelled = await cancelSubscriptionByUser(req.user.id, new Date());
    if (!cancelled) {
      return res.redirect("/plans?subscription_error=cancel_failed");
    }

    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "plan_cancelled",
      ipAddress: req.ip,
      details: { previousPlanCode: currentSubscription.plan_code },
    });

    return res.redirect("/plans?subscription_cancelled=1");
  } catch (err) {
    return next(err);
  }
};

const handleStripeWebhook = async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];
    const event = constructWebhookEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (String(session.mode || "").toLowerCase() !== "subscription") {
        return res.json({ received: true });
      }
      const userId = Number(session.client_reference_id || session.metadata?.userId || 0);
      if (Number.isInteger(userId) && userId > 0 && session.subscription) {
        await upsertSubscription({
          userId,
          planCode: PLAN_CATALOG.pro.code,
          planName: PLAN_CATALOG.pro.name,
          monthlyPrice: Number(PLAN_CATALOG.pro.price) || 0,
          status: "active",
          stripeCustomerId: session.customer ? String(session.customer) : null,
          stripeSubscriptionId: String(session.subscription),
          startsAt: new Date(),
        });
      }
    }

    if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const stripeStatus = String(subscription.status || "").toLowerCase();
      const localStatus = stripeStatus === "active" ? "active" : "cancelled";
      const endsAt = localStatus === "cancelled" ? new Date() : null;
      await updateSubscriptionByStripeId({
        stripeSubscriptionId: String(subscription.id),
        planCode: PLAN_CATALOG.pro.code,
        planName: PLAN_CATALOG.pro.name,
        monthlyPrice: Number(PLAN_CATALOG.pro.price) || 0,
        status: localStatus,
        endsAt,
      });
    }

    return res.json({ received: true });
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

const legacyPlans = (req, res) => {
  const plans = [
    { name: "Starter", price: 0, description: "Access free lessons and community forums.", perks: ["Free mini-courses", "Community support", "Limited certificates"] },
    { name: "Pro", price: 29, description: "Unlimited learning, projects, and certificates.", perks: ["Unlimited course access", "Downloadable materials", "Project reviews", "Priority support"] },
    { name: "Enterprise", price: "Custom", description: "Team analytics and dedicated success manager.", perks: ["Dedicated account manager", "Custom learning paths", "API access", "Advanced analytics"] },
  ];
  res.render("plans", { plans });
};

const mentors = async (req, res, next) => {
  try {
    const lecturers = await getLecturers();
    const instructorIds = lecturers.map((lect) => lect.id);
    const coursesByInstructor = {};
    const statsByInstructor = {};
    if (instructorIds.length) {
      const courseRows = await getCoursesForInstructors(instructorIds);
      courseRows.forEach((course) => {
        if (!coursesByInstructor[course.instructor_id]) {
          coursesByInstructor[course.instructor_id] = [];
        }
        coursesByInstructor[course.instructor_id].push(course);
      });

      const ratingRows = await getInstructorStats(instructorIds);
      ratingRows.forEach((row) => {
        statsByInstructor[row.instructor_id] = {
          avg_rating: Number(row.avg_rating || 0).toFixed(1),
          review_count: row.review_count || 0,
        };
      });
    }
    res.render("mentors", { lecturers, coursesByInstructor, statsByInstructor });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  home,
  plans,
  subscribePlan,
  stripeSubscribeSuccess,
  cancelPlan,
  handleStripeWebhook,
  mentors,
};
