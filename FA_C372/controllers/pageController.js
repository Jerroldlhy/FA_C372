const { getCoursesWithStats, getCoursesForInstructors, getInstructorStats } = require("../models/courseModel");
const { getLecturers } = require("../models/userModel");
const { getReviewsForCourses } = require("../models/reviewModel");
const {
  getSubscriptionByUser,
  upsertSubscription,
  cancelSubscriptionByUser,
} = require("../models/subscriptionModel");
const { logUserActivity } = require("../models/userActivityModel");

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
    cta: "Start Free Trial",
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
    next(err);
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
  cancelPlan,
  mentors,
};
