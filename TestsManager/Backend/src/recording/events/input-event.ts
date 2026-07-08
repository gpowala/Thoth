import { v4 as uuidv4 } from 'uuid';
import { IEvent } from './event-interface';
import { TargetMeta } from './target-meta';

export type InputControlType = 'text' | 'select' | 'checkbox' | 'radio' | 'other';

// Committed value of a form control (fired on `change`). This is the authoritative
// record for DOM text fields — the net result of typing/backspace/paste/autofill —
// so codegen emits a single fill/select/check rather than replaying keystrokes.
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

    constructor(
        timestamp: Date,
        controlType: InputControlType,
        value: string,
        checked: boolean,
        fullViewFilepath: string,
        fullViewBase64: string,
        target?: TargetMeta,
        selectedText?: string
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
    }
}
