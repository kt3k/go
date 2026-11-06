// Applies the saved or preferred colour theme before the page paints.
// (A separate file so the page works under a strict Content-Security-Policy.)
try {
  const t = localStorage.getItem("go:theme");
  if (
    t === "dark" ||
    (!t && matchMedia("(prefers-color-scheme: dark)").matches)
  ) {
    document.documentElement.classList.add("dark");
  }
} catch (_) {
  // storage unavailable: keep the default theme
}
