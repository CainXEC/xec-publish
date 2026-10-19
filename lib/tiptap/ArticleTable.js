import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'

// Article tables. Cells hold plain paragraphs ONLY — no headings, lists, quotes,
// nested tables, and crucially no paywall marker: the server splits the body at
// the marker's position in the HTML string (lib/splitPostBodyAtPaywall), so a
// marker inside a cell would cut the table in half (broken markup on both sides
// of the paywall). The same rule keeps the publish-time YouTube embed out of
// cells. No column resizing: widths would ride in inline styles the sanitizer
// strips anyway, so the reader lays columns out on its own.
const CELL_CONTENT = 'paragraph+'

export const ArticleTableExtensions = [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader.extend({ content: CELL_CONTENT }),
  TableCell.extend({ content: CELL_CONTENT }),
]
