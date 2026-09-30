# NairaPlate Website Redesign — Phase 1

## Goal
Refresh only the public marketing experience with the approved warmer visual direction, official logo, Figtree type, chef imagery, and a new `/our-story` page. Preserve all existing homepage copy and working interactions unless the brief explicitly changes them.

## Implementation

1. **Brand foundation**
   - Update the public-site colour tokens, card shadow, button sizing/radii, typography, and responsive type scale.
   - Load Figtree weights 400–800 through the document head, then scope it to the homepage, Our Story, contact, and signup so logged-in screens keep their current font.
   - Replace old public-site colour literals with the new semantic tokens while enforcing the stated contrast rules.

2. **Official logo and app icons**
   - Replace the reusable logo mark with the exact segmented-ring SVG while preserving all existing component props and wordmark layouts.
   - Update the wordmark to Figtree 800 with the approved spacing and light/dark variants.
   - Replace the favicon with the same blue geometry and regenerate the 192px and 512px app icons as white marks on Naira Blue.
   - Update manifest colours to Deep Navy.

3. **Shared public navigation**
   - Add `/our-story` to desktop navigation and as the first footer link.
   - Keep desktop Contact, Staff Login, and Start Free Trial actions.
   - Simplify the phone header to the logo and compact Free Trial button.

4. **Homepage composition**
   - Rebuild the hero as the approved two-column navy/photo composition using the existing chef-logo JPG/WebP files without modifying them.
   - Replace the old recipe-builder hero card with the computed floating Eba & Egusi cost card driven by `useEbaEgusi(35)` and `formatNaira`.
   - Apply the requested section order and backgrounds, add the Live Calculator label, restyle feature icons and audience pills, and preserve `MEDIA_PATH = "/media"`.
   - Add the Story Teaser section and remove the separate WhatsApp section.
   - Move the WhatsApp conversion button into the trial band while preserving the existing WhatsApp destination.

5. **Our Story page**
   - Create `/our-story` with unique metadata, the approved navy introduction band, exact supplied story copy, chef image treatment, closing statement, and trial/calculator actions.
   - Reuse the public header, footer, floating WhatsApp action, tokens, and typography.

6. **Public contact and signup styling**
   - Apply Figtree and the refreshed public colours to Contact and Signup without changing their forms, validation, submission logic, or wording.

## Responsive and functional verification

- Check `/` and `/our-story` at 375px, 768px, and 1280px with no horizontal scrolling or console errors.
- Confirm the chef apron logo is visible and the hero card displays the computed ₦418.91 and ₦644.48 values.
- Exercise the calculator slider and price-spike control, play all three videos, switch install-guide tabs and reveal install steps, inspect the QR code, and validate WhatsApp links.
- Confirm the official logo appears in header, footer, favicon, and generated app icons.
- Review the changed-file list and verify no logged-in app page, API route, media file, or protected image asset changed.

## Files in scope

**Modify:**
- `src/components/Logo.tsx`
- `src/components/site/site-chrome.tsx`
- `src/styles.css`
- `src/routes/__root.tsx`
- `src/routes/index.tsx`
- `src/routes/contact.tsx`
- `src/routes/signup.tsx`
- `public/favicon.svg`
- `public/icon-192.png`
- `public/icon-512.png`
- `public/manifest.json`

**Create:**
- `src/routes/our-story.tsx`

No other project files will be changed.
