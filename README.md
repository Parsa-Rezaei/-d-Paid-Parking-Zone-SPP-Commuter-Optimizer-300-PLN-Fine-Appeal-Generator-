# Kalkulator SPP Łódź 2026 + Generator wniosku w sprawie opłaty dodatkowej 300 zł (ZDiT)

Statyczna strona w katalogu `public/` (`index.html` + `assets/` + `vendor/`), działająca w przeglądarce, oraz jedna funkcja Cloudflare Pages (`functions/api/verify.js`), która sprawdza płatność w Stripe. Kalkulator i podgląd są bezpłatne; płatny jest wyłącznie plik PDF wniosku (9,99 zł, BLIK przez Stripe).

## Funkcje

**1. Kalkulator postoju i abonamentu SPP Łódź**
- Podstrefa A/B/C, status kierowcy (Łodzianin EL/ZDiT lub przyjezdny/leasing), napęd (spalinowy/hybryda lub elektryczny BEV), data, godziny postoju, liczba dni w miesiącu (1–22).
- Opłaty tylko pn–pt 7:00–19:00. Weekendy i święta ustawowe (w tym Wigilia od 2025 r.) oraz pojazdy elektryczne: 0 zł.
- Rozbicie godzina po godzinie, niepełna godzina liczona proporcjonalnie do minut.
- Koszt miesięczny i roczny.
- Ile tracisz, płacąc stawkę przyjezdnego zamiast stawki Łodzianina.
- Porównanie z abonamentem mieszkańca 365 zł/rok.

**2. Generator wniosku do ZDiT (opłata dodatkowa 300 zł)**
- Cztery podstawy: omyłka w numerze rejestracyjnym, bilet kupiony w aplikacji w chwili kontroli, abonament lub zwolnienie (BEV, karta parkingowa), awaria parkomatu.
- Forma męska/żeńska, lista załączników, licznik terminu 14 dni.
- PDF A4 (strona 1: wniosek, strona 2: lista kontrolna – nie wysyłać).
- Przed płatnością podgląd pokazuje tylko nagłówek pisma; uzasadnienie jest zastąpione szarymi paskami (treść nie trafia do strony).

## Stawki (zł)

| Podstrefa | Status | 1. godz. | 2. godz. | 3. godz. | Suma 3 h | 4. i kolejna |
|---|---|---|---|---|---|---|
| A | Łodzianin | 6,00 | 7,20 | 8,60 | 21,80 | 6,00 |
| A | Przyjezdny | 6,90 | 8,20 | 9,80 | 24,90 | 6,90 |
| B, C | Łodzianin | 5,00 | 6,00 | 7,20 | 18,20 | 5,00 |
| B, C | Przyjezdny | 6,00 | 7,20 | 8,60 | 21,80 | 6,00 |

Adres ZDiT: ul. J. Tuwima 36, 90-002 Łódź.
Podstawa: uchwała nr XIII/329/25 Rady Miejskiej w Łodzi z 15.01.2025 r. (z późn. zm.), ustawa o drogach publicznych, ustawa o elektromobilności. Przed publikacją sprawdź aktualne dane na uml.lodz.pl.

## Struktura

```
public/               ← publikowany katalog (index.html, assets/, vendor/, _headers)
public/assets/config.js  ← cena, link płatności, dane sprzedawcy, partner (bez kluczy!)
functions/api/verify.js  ← Cloudflare Pages Function: weryfikacja płatności w Stripe
src/input.css         ← źródło Tailwind (app.css jest skompilowany)
tests/                ← testy (Node + Playwright)
```

## Uruchomienie sprzedaży (Cloudflare Pages + Stripe)

1. **Stripe → Payment Links → nowy link**: produkt „Wniosek PDF do ZDiT”, cena **9,99 zł (PLN)**, metody płatności: **tylko BLIK**.
   Po płatności: „Nie pokazuj strony potwierdzenia” → przekieruj na
   `https://DOMAIN/?platnosc=sukces&session_id={CHECKOUT_SESSION_ID}`.
   Zanotuj identyfikator linku `plink_…` i jego adres `https://buy.stripe.com/…`.
2. **Stripe → Developers → API keys → Restricted key**: tylko uprawnienie *Checkout Sessions: Read*. Klucz zaczyna się od `rk_live_`. Pełny klucz `sk_…` jest odrzucany przez funkcję.
3. **Cloudflare Pages → projekt z tego repozytorium**:
   - Build command: *(puste)*, **Build output directory: `public`** (katalog `functions/` jest wykrywany automatycznie).
   - Settings → Variables and Secrets (typ *Secret*):
     - `STRIPE_SECRET_KEY=rk_live_…`
     - `PAYMENT_LINK_ID=plink_…`
     - `EXPECTED_AMOUNT=999` (cena w groszach)
     - opcjonalnie `MAX_AGE_DAYS=30`; `ALLOW_TEST_MODE=true` tylko na czas testów w trybie testowym Stripe.
4. **`public/assets/config.js`**: wpisz `paymentUrl: 'https://buy.stripe.com/…'`, `siteUrl`, dane sprzedawcy (`seller`) i ewentualnie partnera (`partner`). Nigdy nie wpisuj tu kluczy.
5. Sprawdź: `https://DOMAIN/api/verify?ping=1` → `{"ready":true}`.

Przepływ: „Pobierz PDF” → okno zamówienia z dwiema obowiązkowymi zgodami (Regulamin + żądanie dostarczenia treści cyfrowej przed upływem terminu odstąpienia, art. 38 pkt 13 ustawy o prawach konsumenta) → sprawdzenie `/api/verify?ping=1` (jeśli serwer nie działa: „Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków”) → formularz zapisany w `sessionStorage`, losowy identyfikator zamówienia w `localStorage` → Payment Link z `client_reference_id` → powrót → weryfikacja w Stripe (3 ponowienia co 2 s) → automatyczne pobranie PDF. Dostęp do ponownego pobrania przez 30 dni w tej samej przeglądarce.

Bez `paymentUrl` sprzedaż jest wyłączona. Tryb demonstracyjny (darmowy PDF) działa tylko na `localhost` / `127.0.0.1`.

Miejsce dla partnera: bez skonfigurowanego `partner` strona pokazuje neutralne pole „Miejsce dla partnera – kontakt” (link z `adContactUrl`).

## Testy

```
npm test          # node tests/verify.test.mjs && node tests/e2e.test.js
```

`tests/verify.test.mjs` – funkcja weryfikująca z atrapą API Stripe. `tests/e2e.test.js` – Playwright/Chromium (+ `pdftotext` z poppler-utils): kalkulator, blokada podglądu, próby obejścia (`?platnosc=sukces`, podrobiony `localStorage`, cudzy link), pełny przepływ z zamockowanym `/api/verify`, polskie znaki w PDF, CSP.

## Bezpieczeństwo

- Brak zewnętrznych skryptów: CSS jest skompilowany (`public/assets/app.css`), a pdfmake 0.2.23 leży w `public/vendor/`.
- `public/_headers`: Content Security Policy tylko `'self'` (`connect-src 'self'` – wyłącznie `/api/verify`), `frame-ancestors 'none'`, HSTS, nosniff. Przekierowanie do Stripe jest nawigacją, więc CSP go nie blokuje.
- Dostęp do PDF daje wyłącznie odpowiedź serwera po sprawdzeniu sesji w Stripe (kwota, waluta PLN, link płatności, `client_reference_id`, tryb live, wiek płatności).
- Cały kod działa w zamkniętym zakresie (IIFE) – funkcje generujące pismo nie są dostępne z konsoli.
- Wszystkie dane z formularza są escapowane przed wstawieniem do HTML. Dane osobowe trafiają tylko do `sessionStorage` bieżącej karty (by przetrwały płatność) i nigdy nie są wysyłane.

Przebudowa CSS po zmianie klas: `npx @tailwindcss/cli@4.1.18 -i src/input.css -o public/assets/app.css --minify` (wymaga `npm i tailwindcss@4.1.18 @tailwindcss/cli@4.1.18`).

## Zastrzeżenie

Generator tworzy wzór pisma i nie stanowi porady prawnej. Wniosek do ZDiT nie jest odwołaniem. Serwis nie jest powiązany z Urzędem Miasta Łodzi ani ZDiT.
