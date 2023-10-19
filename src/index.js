const accordians = document.getElementsByClassName("accordion");
Array.from(accordians).forEach((accordian) => {
  accordian.addEventListener("click", function () {
    this.classList.toggle("accordionactive");
    const panel = this.nextElementSibling;
    if (panel.style.display === "grid") {
      panel.style.display = "none";
    } else {
      panel.style.display = "grid";
    }
  });
});
