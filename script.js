
"use strict";

const currentYear = document.getElementById("current-year");
const vemanaOpen = document.getElementById("vemana-open");
const vemanaDialog = document.getElementById("vemana-dialog");
const vemanaClose = document.getElementById("vemana-close");
const vemanaForm = document.getElementById("vemana-form");
const vemanaPassword = document.getElementById("vemana-password");
const passwordError = document.getElementById("password-error");

const VEMANA_PASSWORD = "vemanapass";

// Replace this with your real Vemana subdomain when it is ready.
const VEMANA_DESTINATION = "https://vemana.fantomx.com/";

currentYear.textContent = new Date().getFullYear();

vemanaOpen.addEventListener("click", () => {
  passwordError.hidden = true;
  vemanaPassword.value = "";
  vemanaDialog.showModal();
  vemanaPassword.focus();
});

vemanaClose.addEventListener("click", () => {
  vemanaDialog.close();
});

vemanaDialog.addEventListener("click", (event) => {
  if (event.target === vemanaDialog) {
    vemanaDialog.close();
  }
});

vemanaForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (vemanaPassword.value === VEMANA_PASSWORD) {
    window.location.assign(VEMANA_DESTINATION);
    return;
  }

  passwordError.hidden = false;
  vemanaPassword.select();
});
