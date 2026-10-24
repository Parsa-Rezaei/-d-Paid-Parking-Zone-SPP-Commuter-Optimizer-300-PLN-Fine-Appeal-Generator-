# Kalkulator SPP Łódź 2026 + Generator wniosku w sprawie opłaty dodatkowej 300 zł (ZDiT)

Aplikacja w jednym pliku (`index.html`), działająca w całości w przeglądarce. Bez serwera, bez zbierania danych.

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

## Stawki (zł)

| Podstrefa | Status | 1. godz. | 2. godz. | 3. godz. | Suma 3 h | 4. i kolejna |
|---|---|---|---|---|---|---|
| A | Łodzianin | 6,00 | 7,20 | 8,60 | 21,80 | 6,00 |
| A | Przyjezdny | 6,90 | 8,20 | 9,80 | 24,90 | 6,90 |
| B, C | Łodzianin | 5,00 | 6,00 | 7,20 | 18,20 | 5,00 |
| B, C | Przyjezdny | 6,00 | 7,20 | 8,60 | 21,80 | 6,00 |

Adres ZDiT: ul. J. Tuwima 36, 90-002 Łódź.
Podstawa: uchwała nr XIII/329/25 Rady Miejskiej w Łodzi z 15.01.2025 r. (z późn. zm.), ustawa o drogach publicznych, ustawa o elektromobilności. Przed publikacją sprawdź aktualne dane na uml.lodz.pl.

## Konfiguracja

W `index.html`, na początku skryptu:

```js
const CONFIG = {
  pdfPrice: '9,99 zł',
  buyCoffeeUrl: 'https://buycoffee.to/TWOJ-PROFIL',
  adContactUrl: 'mailto:reklama@example.com?...'
};
```

## Publikacja

GitHub: Settings → Pages → Deploy from a branch → gałąź z plikiem `index.html` → folder `/ (root)`.

## Zastrzeżenie

Generator tworzy wzór pisma i nie stanowi porady prawnej. Wniosek do ZDiT nie jest odwołaniem. Serwis nie jest powiązany z Urzędem Miasta Łodzi ani ZDiT.
