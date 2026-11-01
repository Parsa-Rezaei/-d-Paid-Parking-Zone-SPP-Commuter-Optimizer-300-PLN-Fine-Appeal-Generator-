/* =====================================================================
   KONFIGURACJA SERWISU – jedyny plik, który edytujesz przed startem.
   NIGDY nie wpisuj tutaj kluczy Stripe (sk_…, rk_…) ani haseł –
   ten plik jest publiczny. Klucze trzymasz wyłącznie w ustawieniach
   Cloudflare Pages (Variables and Secrets).
   ===================================================================== */
window.SPP_CONFIG = Object.freeze({
  siteName: 'Kalkulator SPP Łódź',
  siteUrl: 'https://TWOJA-DOMENA.pl/',

  // Cena PDF w zł – musi być równa cenie produktu w Stripe i zmiennej EXPECTED_AMOUNT (w groszach: 999).
  price: 9.99,

  // Link płatności Stripe (Payment Link, tylko BLIK), np. 'https://buy.stripe.com/abc123'.
  // Pusty = sprzedaż wyłączona (na localhost / 127.0.0.1 działa tryb demonstracyjny).
  paymentUrl: '',

  // Weryfikacja płatności po stronie serwera (functions/api/verify.js na Cloudflare Pages).
  verifyEndpoint: '/api/verify',

  // Partner / reklama. Puste pola = neutralne pole „Miejsce dla partnera – kontakt”.
  partner: Object.freeze({
    name: '',   // nazwa partnera, np. prawdziwy parking strzeżony, z którym masz umowę
    text: '',   // krótki opis oferty partnera
    url: ''     // link partnerski (https://…)
  }),
  // Kontakt w sprawie współpracy reklamowej (https:// lub mailto:).
  adContactUrl: 'mailto:reklama@example.com?subject=Reklama%20-%20Kalkulator%20SPP%20%C5%81%C3%B3d%C5%BA',

  // Dane sprzedawcy do regulaminu i polityki prywatności.
  seller: Object.freeze({
    name: '[imię i nazwisko / firma]',
    address: '[adres]',
    email: '[e-mail kontaktowy]',
    nip: ''
  })
});
