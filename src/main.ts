import { Plugin, Notice, editorEditorField, editorViewField } from "obsidian";
import { EditorView, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, Transaction } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

export default class ContainerAttributesPlugin extends Plugin {

  async onload() {
    this.buildZoomExtension();
  }

  buildZoomExtension() {
    const zoomEffect = StateEffect.define<{ from: number; to: number }>();
    const zoomOutEffect = StateEffect.define<{ from: number; to: number }>();

    const zoomStateField = StateField.define<DecorationSet>({
      create(state: EditorState) {
        // this will be called on plugin initialization and any editor state resets
        // note: editor state is reset any time a new file is loaded into the editor
        const editorView = state.field(editorEditorField); // acquire the editorView from state
        editorView.dom.parentElement.removeClass("is-zoomed-in"); // remove any left over classes
        return Decoration.none; // clear decorations
      },
      update(effects: DecorationSet, tr: Transaction) {
        // this listens for specific effects that belong to us and applies our logic
        // note: when registered, this method will receive ALL editor updates
        //       make sure you act on only what you need and ignore the rest
        effects = effects?.map(tr.changes);
        for (let effect of tr.effects) {
          if (effect && effect.value) {
            let { from, to } = effect.value;
            if (effect.is(zoomEffect)) {
              // act on our zoomEffect, when seen
              if (from === 0) {
                effects = effects.update({ filter: from => from != 0 }); // remove any existing header decorations
                effects = effects.update({ add: [zoomMarkHeader.range(from, to)] });
              } else {
                effects = effects.update({ add: [zoomMarkHidden.range(from, to)] });
              }
            } else if (effect.is(zoomOutEffect)) {
              // act on our zoomOut effect, when seen
              effects = effects.update({
                filter: e => false, // remove all decorations
                filterFrom: from,
                filterTo: to,
              });
            }
          }
        }
        return effects;
      },

      provide: (f: any) => EditorView.decorations.from(f),
    });

    // here we call the new Obsidian method to register our StateField as an extension
    // as soon as we register the StateField, the StateField.create() method will be called
    // additionally, ALL editor state changes will be sent to StateField.update()
    this.registerEditorExtension(zoomStateField);

    // here we define our bread crumb widget which we'll insert into the beginning of the document, on zoom
    class HeaderWidget extends WidgetType {
      heading: string;
      displayName: string;

      constructor(heading: string, displayName: string) {
        super();
        this.heading = heading;
        this.displayName = heading;
      }

      toDOM() {
        let wrap = document.createElement("div");
        wrap.className = "cm-zoom-header";
        let header = wrap.appendChild(document.createElement("span"));
        // create a naive bread crumb
        header.textContent = `${this.displayName} > ${this.heading}`;
        return wrap;
      }

      ignoreEvent() {
        return false;
      }
    }

    const zoomMarkHidden = Decoration.replace({ block: true });

    let zoomMarkHeader: Decoration;

    const zoomOut = (view: EditorView) => {
      const unmarkHiddenLines = () => {
        return [zoomOutEffect.of({ from: 0, to: view.state.doc.length })];
      };

      const sourceView = view.dom.parentElement;
      sourceView.removeClass("is-zoomed-in");

      let effects: StateEffect<unknown>[];
      effects = unmarkHiddenLines();

      if (!effects.length) return false;

      // if (!view.state.field(zoomState, false)) effects.push(StateEffect.appendConfig.of([zoomState]));
      view.dispatch({ effects });

      return true;
    };

    const zoomIn = (view: EditorView) => {
      const cursorAtPos = view.state.selection.ranges[0].from; // ignore multiple selections
      const cursorAtLine = view.state.doc.lineAt(cursorAtPos);
      const headingText = cursorAtLine.text?.replace(/(^#+\s)|(^\s*[-*]\s)/, "");
      const displayName = view.state.field(editorViewField)?.getDisplayText();
      const endPos = view.state.doc.length;

      zoomMarkHeader = Decoration.replace({ block: true, widget: new HeaderWidget(headingText, displayName) });

      // we can't zoom if we can't fold
      if (!(this.app.vault as any).config.foldHeading || !(this.app.vault as any).config.foldIndent) {
        new Notice(`In order to zoom, you must first enable "Fold heading" and "Fold indent" under Settings -> Editor`);
        return;
      }

      // get the foldable range using foldable from "@codemirror/language"
      let foldRange = foldable(view.state, cursorAtLine.from, cursorAtLine.to);

      if (!foldRange) return false;

      const markHiddenLines = () => {
        // since zooming is the opposite of folding, we get the foldable range and then fold the inverse
        let effects: StateEffect<{ from: number; to: number }>[] = [];
        // fold from the end of the identified section, all the way to the end of the document
        if (foldRange.to + 1 < endPos) effects.push(zoomEffect.of({ from: foldRange.to + 1, to: endPos }));
        // if we're not on the first line, fold from line 1 to the start of the identified section
        if (cursorAtLine.from - 1 > 0) {
          effects.push(zoomEffect.of({ from: 0, to: cursorAtLine.from - 1 }));
        } else {
          if (!document.querySelector(".is-zoomed-in")) effects.push(zoomEffect.of({ from: 0, to: 0 }));
        }
        return effects;
      };

      const markdownSourceViewDOM = view.dom.parentElement;
      markdownSourceViewDOM.addClass("is-zoomed-in");

      const effects = markHiddenLines();
      if (!effects.length) return false;

      view.dispatch({ effects });
      return true;
    };


    // now we bind Obsidian commands to zoomIn and zoomOut
    this.addCommand({
      id: "cm6-zoom-in",
      name: "CM6 Zoom In",
      editorCallback: editor => zoomIn(editor.cm),
    });

    this.addCommand({
      id: "cm6-zoom-out",
      name: "CM6 Zoom Out",
      editorCallback: editor => zoomOut(editor.cm),
    });
  }
}
