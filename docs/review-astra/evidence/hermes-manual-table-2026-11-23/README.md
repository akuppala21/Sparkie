# Empty cells and row scope in source manuals

The original source reader collapsed blank cells. The first row of the HTML Standard’s Sudoku example came back as `1 3 6 4 7 9`. Six numbers survived and their positions in the nine columns were lost. In a benchmark table the same loss can place a measurement under the wrong heading. A link to one row also returned no section, and a long table with legal omitted closing tags could exhaust the reader’s HTML nesting limit. [Publisher’s example](https://html.spec.whatwg.org/multipage/tables.html#the-table-element)

The reader now keeps visible cell boundaries and row breaks, marks merged cells with their published span attributes, and respects row and table links when the publisher supplies an ID. The original HTML remains available for complex layouts. The change uses the existing on-demand reader and adds no inference request.

| Check on Spark 2 | Result |
| --- | --- |
| Previous reader with three new regression cases | All three reproduced the errors |
| Candidate reader and affected Python callers, including native integration | 130 passed in 5.80 seconds |
| Independent Chromium comparison on the publisher’s retained Sudoku example | All 81 cell positions, including blanks, matched in the nine reconstructed rows |

The [browser comparison](compare.cjs) read the example code from the retained publisher HTML, parsed that example with Chromium’s DOM parser and kept the text of every cell. Both revisions of the reader processed the same example. The retained page SHA-256 was `9b190ce1f319e5fe5702c3dbee82e078386b4d73ff8931dab308fa3807175fcc`. An initial browser launch looked for a cached Playwright browser. The completed comparison used the worker image’s installed Chromium.

The 130 checks and cell comparison measure the information supplied to Hermes. They supply no accuracy score for a model’s final research answer. This reader revision was prepared after the sealed ownerstop1 candidate.
