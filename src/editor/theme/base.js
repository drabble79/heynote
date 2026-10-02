import { EditorView } from '@codemirror/view';


export const heynoteBase = EditorView.theme({
    ".cm-line": {
        padding: "0 6px",
    },
    ".cm-panels": {
        fontSize: "12px",
    },
    ".cm-panels.cm-panels-top": {
        borderBottom: "none",
    },
    ".cm-panels .cm-panel": {
        
    },
    '.cm-panels .cm-textfield': {
        fontSize: "1em",
        borderRadius: "2px",
    },
    '.cm-panels .cm-button': {
        border: "none",
        borderRadius: "2px",
        fontSize: "1em",
        cursor: "pointer",
        padding: "2px 12px",
    },
    '.cm-panels .cm-button:focus': {
        border: "none",
        outline: "2px solid #48b57e",
        outlineOffset: "1px",
    },
    ".cm-panel.cm-search label": {
        fontSize: "1em",
    },
    ".cm-panel.cm-search input[type=checkbox]": {
        position: "relative",
        top: "2px",
    },
    ".cm-panel.cm-search input[type=checkbox]:focus-visible": {
        outline: "2px auto #48b57e",
        outlineOffset: "2px",
        //borderRadius: "3px",
    },
    ".cm-panel.cm-search [name=close]" : {
        fontSize: "18px",
        right: "4px",
        top: "4px",
        width: "22px",
        height: "22px",
        border: "2px solid transparent",
        borderRadius: "2px",
        cursor: "pointer",
    },
    ".cm-panel.cm-search [name=close]:focus-visible" : {
        border: "2px solid #48b57e",
        outline: "none",
    },

    "&.cm-editor.cm-focused": {
        outline: "none",
    },
    ".cm-content": {
        paddingTop: 4,
    },
    '.cm-gutters': {
        padding: '0 2px 0 4px',
        userSelect: 'none',
    },
    '.cm-foldGutter': {
        marginLeft: '0px',
    },
    '.cm-gutters .cm-gutterElement span': {
        opacity: 1,
        transition: "opacity 200ms",
    },
    '.cm-foldGutter .cm-gutterElement span[title*="Fold"]': {
        opacity: 0,
    },
    '.cm-gutters:hover .cm-gutterElement span[title*="Fold"]': {
        opacity: 1,
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftWidth:'2px', 
        paddingTop: '4px',
        marginTop: '-2px',
        boxSizing: 'content-box',
    },
    '.cm-highlightSpace': {
        'background-image': 'radial-gradient(circle at 50% 54%, #aaaaaa60 11%, transparent 5%)',
    },
    '.cm-highlightTab': {
        'background-image': `url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8' standalone='no'%3F%3E%3C!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'%3E%3Csvg width='100%25' height='100%25' viewBox='0 0 20 20' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' xml:space='preserve' xmlns:serif='http://www.serif.com/' style='fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;'%3E%3Cg%3E%3Cpath d='M15.063,9.457l-12.424,0.061l0,0.978l12.518,-0.061l-2.48,2.526l0.7,0.707l2.917,-2.967l0.006,0.006l0.7,-0.707l-3.599,-3.657l-0.7,0.707l2.362,2.407Z' style='fill-opacity:0.15;'/%3E%3C/g%3E%3C/svg%3E")`,
        'background-position': 'left 90%',
        'background-size': 'auto 100%',
        'background-repeat': 'no-repeat',
    },
    '.heynote-blocks-layer': {
        width: '100%',
    },
    '.heynote-blocks-layer .block-even, .heynote-blocks-layer .block-odd': {
        width: '100%',
        boxSizing: 'content-box',
    },
    '.heynote-blocks-layer .block-even:first-child': {
        borderTop: 'none',
    },
    '.heynote-block-start': {
        height: '12px',
    },
    '.heynote-block-start.first': {
        height: '0px',
    },
    '.heynote-math-result': {
        paddingLeft: "12px",
        position: "relative",
    },
    '.heynote-math-result .inner': {
        background: '#48b57e',
        //background: '#4892b5',
        color: '#fff',
        padding: '0px 4px',
        borderRadius: '2px',
        boxShadow: '0 0 3px rgba(0,0,0, 0.1)',
        cursor: 'pointer',
        whiteSpace: "nowrap",
    },
    '.heynote-math-result-copied': {
        position: "absolute",
        top: "0px",
        left: "0px",
        marginLeft: "calc(100% + 10px)",
        width: "60px",
        transition: "opacity 500ms",
        transitionDelay: "1000ms",
        color: "rgba(0,0,0, 0.8)",
    },
    '.heynote-math-result-copied.fade-out': {
        opacity: 0,
    },
    '.heynote-link': {
        textDecoration: "underline",
    },
    '.heynote-color-preview': {
        display: "inline-block",
        width: "0.8em",
        height: "0.8em",
        marginRight: "0.3em",
        border: "1px solid rgba(128,128,128,0.65)",
        borderRadius: "2px",
        boxSizing: "border-box",
        verticalAlign: "-0.08em",
    },

    ".cm-searchMatch": { backgroundColor: "#ffff00" },
    ".cm-searchMatch-selected": {
        backgroundColor: "#ffaa20",
        outline: "1px solid #e46d00",
    },

    ".cm-foldPlaceholder .created-time": {
        float: "right",
        marginRight: "6px",
    },

    // Rich Markdown. Structure only - colours live in theme/light.js and theme/dark.js, so the
    // two themes stay the single place where palette decisions are made.
    ".cm-rmd-heading": {
        fontWeight: "700",
        lineHeight: "1.3",
    },
    ".cm-rmd-h1": { fontSize: "1.6em" },
    ".cm-rmd-h2": { fontSize: "1.4em" },
    ".cm-rmd-h3": { fontSize: "1.22em" },
    ".cm-rmd-h4": { fontSize: "1.1em" },
    ".cm-rmd-h5": { fontSize: "1em" },
    ".cm-rmd-h6": { fontSize: "1em" },

    ".cm-rmd-quote": {
        paddingLeft: "0.9em",
        borderLeft: "3px solid rgba(128,128,128,0.45)",
    },

    ".cm-rmd-code": {
        backgroundColor: "rgba(128,128,128,0.10)",
    },

    ".cm-rmd-rule": {
        padding: "0.35em 0",
    },
    ".cm-rmd-rule hr": {
        border: "none",
        borderTop: "1px solid rgba(128,128,128,0.5)",
        margin: "0",
    },

    ".cm-rmd-bullet": {
        // keep the glyph the same width as the "- " it replaces so text still lines up
        display: "inline-block",
        width: "1ch",
    },

    ".cm-rmd-table": {
        padding: "0.3em 0",
        overflowX: "auto",
    },
    ".cm-rmd-table table": {
        borderCollapse: "collapse",
        // tables are content, not code: proportional text reads better and wraps sensibly
        fontFamily: "inherit",
    },
    ".cm-rmd-table th, .cm-rmd-table td": {
        border: "1px solid rgba(128,128,128,0.45)",
        padding: "0.25em 0.6em",
        textAlign: "left",
        verticalAlign: "top",
    },
    ".cm-rmd-table th": {
        fontWeight: "700",
        backgroundColor: "rgba(128,128,128,0.12)",
    },
})
