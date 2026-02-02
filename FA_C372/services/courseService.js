const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const displayInstructorName = (course) => {
  if (course.instructor_name && String(course.instructor_name).trim() !== "") {
    return course.instructor_name;
  }
  return course.instructor_username || null;
};

const toCourseResponse = (course) => ({
  course_id: course.course_id,
  course_name: course.course_name,
  description: course.description,
  price: course.price,
  category: course.category,
  skill_level: course.skill_level || null,
  language: course.language || null,
  learning_outcomes: course.learning_outcomes || null,
  resources: course.resources || null,
  course_availability: {
    is_active: typeof course.is_active === "undefined" ? null : Boolean(course.is_active),
    seats_available:
      typeof course.seats_available === "undefined" ? null : course.seats_available,
  },
  instructor_name: displayInstructorName(course),
});

module.exports = {
  parsePagination,
  toCourseResponse,
  displayInstructorName,
};
