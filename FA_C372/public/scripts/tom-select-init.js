(() => {
  const initTomSelect = () => {
    if (typeof window.TomSelect !== "function") return;

    document.querySelectorAll("select").forEach((selectEl) => {
      if (selectEl.tomselect || selectEl.dataset.tomSelectIgnore === "true") return;

      const isSingleSelect = !selectEl.multiple;
      new window.TomSelect(selectEl, {
        create: false,
        persist: false,
        maxItems: isSingleSelect ? 1 : null,
        allowEmptyOption: true,
        searchField: ["text"],
        placeholder: selectEl.getAttribute("data-placeholder") || "Select option...",
      });
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTomSelect);
  } else {
    initTomSelect();
  }
})();
