# Kalkulator SPP Łódź 2026 + Generator wniosku w sprawie opłaty dodatkowej 300 zł (ZDiT)

A single-file web app (`index.html`) in Polish, made up of a Łódź Paid Parking Zone (Strefa Płatnego Parkowania) cost calculator and a PDF request generator for the 300 PLN additional fee. Everything runs in the browser and there is no backend.

## Features

**1. Precyzyjny Kalkulator Postoju i Abonamentu SPP Łódź**
- Inputs: subzone A/B/C, driver status (Łodzianin EL/ZDiT vs Przyjezdny/leasing), engine (combustion/hybrid vs BEV), date, start and end time, parking days per month (1–22).
- The calculator bills only 07:00–19:00, Monday to Friday. Saturdays, Sundays and Polish public holidays are free (including the Easter-based holidays and Wigilia from 2025). BEV parking is free.
- Shows an hour-by-hour breakdown, and a partial hour is billed pro rata by the minute.
- Projects monthly and annual cost.
- Shows the loss from paying Przyjezdny rates instead of Łodzianin rates (per day, month and year).
- Compares that cost with the 365 PLN/year resident subscription and gives the break-even number of parking days per year.

**2. Generator wniosku do ZDiT (opłata dodatkowa 300 zł)**
- Offers four justification templates:
  - typo in the registration number
  - ticket bought in the app at the moment of the check
  - subscription or statutory exemption (BEV, subscription, parking card)
  - broken parking meter
- Grammatical gender switch (uiściłem/uiściłam).
- Attachment checklist that adapts to the chosen template, plus custom items.
- 14-day deadline tracker counted from the date of the check.
- A4 PDF output (pdfmake, Roboto with Polish glyphs). Page 1 is the letter. Page 2 is an internal checklist with submission channels and is marked as not to be sent.
- A payment modal (BuyCoffee.to / BLIK) gates the PDF download. There is also an ad slot and `SoftwareApplication` + `FAQPage` JSON-LD.

## Tariff data (hard-coded in `SPP` inside `index.html`)

| Subzone | Status | 1st h | 2nd h | 3rd h | 3 h total | 4th h+ |
|---|---|---|---|---|---|---|
| A | Łodzianin | 6.00 | 7.20 | 8.60 | 21.80 | 6.00 |
| A | Przyjezdny | 6.90 | 8.20 | 9.80 | 24.90 | 6.90 |
| B, C | Łodzianin | 5.00 | 6.00 | 7.20 | 18.20 | 5.00 |
| B, C | Przyjezdny | 6.00 | 7.20 | 8.60 | 21.80 | 6.00 |

Other fixed values: resident subscription 365 PLN/year, additional fee 300 PLN with a 14-day deadline, payment due within 5 minutes of parking.

The authority address is **ZDiT, ul. J. Tuwima 36, 90-002 Łódź**. This is the address published by Urząd Miasta Łodzi for these requests. It replaces the address in the original brief (ul. Tuwima 22/26 lok. 910), which could not be confirmed.

### Verification status

- **Hourly rates, 7:00–19:00 hours, 365 PLN subscription:** match several secondary sources (Karta Łodzianina, anypark.pl, lodz.pl reporting). Legal basis: uchwała nr XIII/329/25 Rady Miejskiej w Łodzi z 15.01.2025, as amended by XX/559/25 and XXV/717/25.
- **300 PLN additional fee:** attributed to the uml.lodz.pl FAQ.
- **14-day deadline:** found only on anypark.pl.
- **Official texts not read directly:** the uml.lodz.pl, zdit.uml.lodz.pl and dziennik.lodzkie.eu pages could not be opened from the build environment. Check the rates and the address against them before going live.
- **Per-minute pro rata billing:** a modelling assumption. The UI says that apps may apply minimum durations or their own rounding.
- **Legal citations in the letters:**
  - art. 13 ust. 1 pkt 1, art. 13 ust. 3 and art. 13f ust. 1 of the Road Act (ustawa o drogach publicznych)
  - art. 2 pkt 12 of the Electromobility Act (ustawa o elektromobilności)
  - art. 2 of the Constitution and art. 8 § 1 k.p.a., cited with "por."

  Check the current consolidated texts on ISAP.
- **Subzone B coverage (Radiostacja, Orientarium ZOO, Aquapark Fala):** taken from the brief. The page refers users to the ZDiT map for the exact boundaries.

## Configuration

Edit `CONFIG` at the top of the main `<script>` in `index.html`:

```js
const CONFIG = {
  pdfPrice: '9,99 zł',
  buyCoffeeUrl: 'https://buycoffee.to/TWOJ-PROFIL', // your BuyCoffee.to profile
  adContactUrl: 'mailto:reklama@example.com?...'    // ad-slot contact
};
```

The payment modal shows a configuration warning until `buyCoffeeUrl` is changed.

**Payment limitation:** with no backend, the paywall works on trust. The download unlocks after the user ticks "Potwierdzam dokonanie wpłaty", and anyone with browser dev tools can skip it. Verified payments need a server-side payment provider (for example Przelewy24 or Stripe with BLIK) that issues a signed download token.

## External dependencies (CDN, pinned)

- `@tailwindcss/browser@4.1.18` (jsDelivr)
- `pdfmake@0.2.23` + `vfs_fonts.js` (jsDelivr)

## Deploy

The repository works as a static site. To use GitHub Pages: Settings → Pages → Source: *Deploy from a branch* → the branch that contains `index.html` / root.

## Disclaimer

The generator produces a template letter and is not legal advice. According to Urząd Miasta Łodzi, the request to ZDiT is not an appeal procedure, and objections can only be raised later, during administrative enforcement. The project is not affiliated with Urząd Miasta Łodzi or ZDiT.
