(() => {
  const toggles = document.querySelectorAll("[data-password-toggle]");
  if (!toggles.length) return;

  toggles.forEach((toggleBtn) => {
    const targetId = toggleBtn.getAttribute("data-password-toggle");
    const input = document.getElementById(targetId);
    if (!input) return;

    toggleBtn.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggleBtn.classList.toggle("is-visible", isPassword);
      toggleBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    });
  });
})();
