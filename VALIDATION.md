# Validation (Beta)

## Current local checks

- 82 automated tests passed locally on Node.js 21.7.2. They cover accounting, subscription windows, quota precedence, scheduling, account isolation, request gates, response bounds, export privacy, Pro $200 eligibility boundaries and expiry, locale selection, translation coverage and switching languages with dynamic counts. Public supported runtime/CI targets Node.js 22.
- Syntax checks and source/distribution consistency passed. All four GitHub workflow/issue YAML files parsed successfully.
- CI is configured to run tests, syntax checks and source/distribution consistency on Node.js 22 for Windows and Linux. Hosted CI has not run until the repository is uploaded.
- No new requests were sent to a real ChatGPT account during release preparation. Public installation/update links have not been deployed.

## Offline browser checks

Version 0.5.0 was verified against synthetic session, account, subscription, empty quota and cloud-history responses. One click completed multiple batches and counted eight conversations. Reload restored counters without another identify click: identity requests increased by two while list/detail/quota counts remained unchanged. A simulated new answer increased total usage from 8 to 9 and changed remaining from 42/50 to 41/50, with one new detail request; unchanged conversations were not fetched again. Earlier checks verified pause and enabled monitoring preferences surviving reload.

The public demo screenshot uses synthetic responses and dates. It is not a screenshot of a user's account or evidence of actual server quota values.

Version 0.5.1 was checked offline in Spanish, English and Chinese. Switching languages retained the same nine observed answers and 41/50 remaining estimate. Reload kept the Spanish selection and restored counters with only two additional identity requests; list/detail/quota request counts did not change. Spanish settings, helper text and accessible field labels were translated. Desktop buttons, headers and counter rows had no measured horizontal overflow. Native language names intentionally remain in their own scripts; third-party/browser error messages and exported accounting metadata retain their original text. Human native-speaker review and live Tampermonkey localization remain pending.

## Pending live checks

See docs/LIVE_VALIDATION.md for real Tampermonkey acceptance. Private API access, actual branch/regeneration charging, deleted histories, tier eligibility, full account-switch behavior and a natural 429 recovery still require live verification. Do not intentionally generate rate limits to test them.

The preset numbers and Pro $200 sharing are project configuration. Official eligibility dates, cached evidence and expiry are implemented; a recent renewal alone cannot establish eligibility or ineligibility. Source distinctions and the local expiry convention are in docs/QUOTA_POLICY.md. Fresh server signals override defaults.
