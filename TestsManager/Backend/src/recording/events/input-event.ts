import { v4 as uuidv4 } from 'uuid';
import { IEvent } from './event-interface';
import { TargetMeta } from './target-meta';

export type InputControlType = 'text' | 'select' | 'checkbox' | 'radio' | 'other';

// One captured keystroke typed into an editable DOM field: the key (`event.key`:
// a char, or a name like 'Backspace'/'Enter') and the time it was pressed (ms).
export interface KeyStroke {
    key: string;
    t: number;
}

// Committed value of a form control (fired on `change`). This is the authoritative
// record for DOM text fields — the net result of typing/backspace/paste/autofill —
// so codegen emits a single fill/select/check rather than replaying keystrokes.
// `keys` is a SUPPLEMENTARY raw keystroke sequence gathered while the field was
// typed into (not used for replay today; retained for future auto-fill/analysis).
export class InputEvent implements IEvent {
    public id: string;
    public timestamp: Date;
    public controlType: InputControlType;
    public value: string;
    public checked: boolean;
    public selectedText?: string;
    public fullViewFilepath: string;
    public fullViewBase64: string;
    public target?: TargetMeta;
    public keys?: KeyStroke[];

    constructor(
        timestamp: Date,
        controlType: InputControlType,
        value: string,
        checked: boolean,
        fullViewFilepath: string,
        fullViewBase64: string,
        target?: TargetMeta,
        selectedText?: string,
        keys?: KeyStroke[]
    ) {
        this.id = uuidv4();
        this.timestamp = timestamp;
        this.controlType = controlType;
        this.value = value;
        this.checked = checked;
        this.fullViewFilepath = fullViewFilepath;
        this.fullViewBase64 = fullViewBase64;
        this.target = target;
        this.selectedText = selectedText;
        this.keys = keys;
    }
}
