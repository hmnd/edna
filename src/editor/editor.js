import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, lineNumbers } from "@codemirror/view";
import { SET_CONTENT, heynoteEvent } from "./annotation.js";
import {
  addNewBlockAfterCurrent,
  addNewBlockAfterLast,
  addNewBlockBeforeCurrent,
  addNewBlockBeforeFirst,
  changeCurrentBlockLanguage,
  gotoBlock,
  gotoNextBlock,
  gotoPreviousBlock,
  insertNewBlockAtCursor,
  selectAll,
  triggerCurrenciesLoaded,
} from "./block/commands.js";
import {
  blockLineNumbers,
  blockState,
  getActiveNoteBlock,
  noteBlockExtension,
} from "./block/block.js";
import { foldGutter, indentUnit } from "@codemirror/language";
import {
  formatBlockContent,
  runBlockContent,
  runBlockFunction,
} from "./block/format-code.js";

import { autoSaveContent } from "./save.js";
import { closeBrackets } from "@codemirror/autocomplete";
import { customSetup } from "./setup.js";
import { ednaKeymap } from "./keymap.js";
import { emacsKeymap } from "./emacs.js";
import { focusEditorView } from "../cmutils.js";
import { getFontTheme } from "./theme/font-theme.js";
import { heynoteBase } from "./theme/base.js";
import { heynoteCopyCut } from "./copy-paste";
import { heynoteDark } from "./theme/dark.js";
import { heynoteLang } from "./lang-heynote/heynote.js";
import { heynoteLight } from "./theme/light.js";
import { languageDetection } from "./language-detection/autodetect.js";
import { links } from "./links.js";
import { markdown } from "@codemirror/lang-markdown";
import { todoCheckboxPlugin } from "./todo-checkbox";

function getKeymapExtensions(editor, keymap) {
  if (keymap === "emacs") {
    return emacsKeymap(editor);
  } else {
    return ednaKeymap(editor);
  }
}

export class EdnaEditor {
  constructor({
    element,
    content,
    focus = true,
    theme = "light",
    saveFunction = null,
    keymap = "default",
    emacsMetaKey,
    showLineNumberGutter = true,
    showFoldGutter = true,
    bracketClosing = false,
    spacesPerTab = 2,
    fontFamily,
    fontSize,
  }) {
    this.element = element;
    this.themeCompartment = new Compartment();
    this.keymapCompartment = new Compartment();
    this.lineNumberCompartmentPre = new Compartment();
    this.lineNumberCompartment = new Compartment();
    this.foldGutterCompartment = new Compartment();
    this.readOnlyCompartment = new Compartment();
    this.closeBracketsCompartment = new Compartment();
    this.deselectOnCopy = keymap === "emacs";
    this.emacsMetaKey = emacsMetaKey;
    this.fontTheme = new Compartment();
    this.saveFunction = saveFunction;
    this.tabsCompartment = new Compartment();

    const makeTabState = (tabsAsSpaces, tabSpaces) => {
      const indentChar = tabsAsSpaces ? " ".repeat(tabSpaces) : "\t";
      const v = indentUnit.of(indentChar);
      return this.tabsCompartment.of(v);
    };

    let updateListenerExtension = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // console.log("docChanged:", update)
        this.element.dispatchEvent(new Event("docChanged"));
      }
    });
    this.createState = (content) => {
      const state = EditorState.create({
        doc: content || "",
        extensions: [
          updateListenerExtension,
          this.keymapCompartment.of(getKeymapExtensions(this, keymap)),
          heynoteCopyCut(this),

          //minimalSetup,
          this.lineNumberCompartment.of(
            showLineNumberGutter ? [lineNumbers(), blockLineNumbers] : [],
          ),
          customSetup,
          this.foldGutterCompartment.of(showFoldGutter ? [foldGutter()] : []),

          this.closeBracketsCompartment.of(
            bracketClosing ? [closeBrackets()] : [],
          ),

          this.readOnlyCompartment.of([]),

          this.themeCompartment.of(
            theme === "dark" ? heynoteDark : heynoteLight,
          ),
          heynoteBase,
          this.fontTheme.of(getFontTheme(fontFamily, fontSize)),
          makeTabState(true, spacesPerTab),
          EditorView.scrollMargins.of((f) => {
            return { top: 80, bottom: 80 };
          }),
          heynoteLang(),
          noteBlockExtension(this),
          languageDetection(() => this.view),

          // set cursor blink rate to 1 second
          drawSelection({ cursorBlinkRate: 1000 }),

          // add CSS class depending on dark/light theme
          EditorView.editorAttributes.of((view) => {
            return {
              class: view.state.facet(EditorView.darkTheme)
                ? "dark-theme"
                : "light-theme",
            };
          }),

          saveFunction ? autoSaveContent(saveFunction, 2000) : [],

          todoCheckboxPlugin,
          markdown(),
          links,
        ],
      });
      return state;
    };
    const state = this.createState(content);

    this.view = new EditorView({
      state: state,
      parent: element,
    });

    if (focus) {
      this.view.dispatch({
        selection: {
          anchor: this.view.state.doc.length,
          head: this.view.state.doc.length,
        },
        scrollIntoView: true,
      });
      this.view.focus();
    }
  }

  setTabsState(tabsAsSpaces, tabSpaces) {
    if (!this.view) return;
    const indentChar = tabsAsSpaces ? " ".repeat(tabSpaces) : "\t";
    const v = indentUnit.of(indentChar);
    this.view.dispatch({
      effects: this.tabsCompartment.reconfigure(v),
    });
  }

  getContent() {
    return this.view.state.sliceDoc();
  }

  setContent(content) {
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: content,
      },
      annotations: [heynoteEvent.of(SET_CONTENT)],
    });
    this.view.dispatch({
      selection: {
        anchor: this.view.state.doc.length,
        head: this.view.state.doc.length,
      },
      scrollIntoView: true,
    });
  }

  getBlocks() {
    // @ts-ignore
    return this.view.state.facet(blockState);
  }

  getCursorPosition() {
    return this.view.state.selection.main.head;
  }

  getActiveNoteBlock() {
    return getActiveNoteBlock(this.view.state);
  }

  focus() {
    // console.log("focus");
    focusEditorView(this.view);
    //this.view.focus()
  }

  isReadOnly() {
    const { state } = this.view;
    return state.readOnly;
  }

  setReadOnly(readOnly) {
    this.view.dispatch({
      effects: this.readOnlyCompartment.reconfigure(
        readOnly ? [EditorState.readOnly.of(true)] : [],
      ),
    });
  }

  setFont(fontFamily, fontSize) {
    let ff = getFontTheme(fontFamily, fontSize);
    this.view.dispatch({
      effects: this.fontTheme.reconfigure(ff),
    });
  }

  setTheme(theme) {
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(
        theme === "dark" ? heynoteDark : heynoteLight,
      ),
    });
  }

  setKeymap(keymap, emacsMetaKey) {
    this.deselectOnCopy = keymap === "emacs";
    this.emacsMetaKey = emacsMetaKey;
    this.view.dispatch({
      effects: this.keymapCompartment.reconfigure(
        getKeymapExtensions(this, keymap),
      ),
    });
  }

  setCurrentLanguage(lang, auto = false) {
    changeCurrentBlockLanguage(this.view.state, this.view.dispatch, lang, auto);
  }

  setLineNumberGutter(show) {
    this.view.dispatch({
      effects: this.lineNumberCompartment.reconfigure(
        show ? [lineNumbers(), blockLineNumbers] : [],
      ),
    });
  }

  setFoldGutter(show) {
    this.view.dispatch({
      effects: this.foldGutterCompartment.reconfigure(
        show ? [foldGutter()] : [],
      ),
    });
  }

  setBracketClosing(value) {
    this.view.dispatch({
      effects: this.closeBracketsCompartment.reconfigure(
        value ? [closeBrackets()] : [],
      ),
    });
  }

  async runBlockFunction(fdef, replace) {
    await runBlockFunction(this.view, fdef, replace);
  }

  runCurrentBlock() {
    runBlockContent(this.view);
  }

  currenciesLoaded() {
    triggerCurrenciesLoaded(this.view.state, this.view.dispatch);
  }

  addNewBlockAfterCurrent() {
    addNewBlockAfterCurrent(this.view);
  }

  addNewBlockBeforeCurrent() {
    addNewBlockBeforeCurrent(this.view);
  }

  addNewBlockAfterLast() {
    addNewBlockAfterLast(this.view);
  }

  addNewBlockBeforeFirst() {
    addNewBlockBeforeFirst(this.view);
  }

  insertNewBlockAtCursor() {
    insertNewBlockAtCursor(this.view);
  }

  gotoBlock(n) {
    gotoBlock(n, this.view);
  }

  gotoNextBlock() {
    gotoNextBlock(this.view);
  }

  gotoPreviousBlock() {
    gotoPreviousBlock(this.view);
  }

  selectAll() {
    selectAll(this.view);
  }
}

/*// set initial data
editor.update([
    editor.state.update({
        changes:{
            from: 0,
            to: editor.state.doc.length,
            insert: initialData,
        },
        annotations: heynoteEvent.of(INITIAL_DATA),
    })
])*/
