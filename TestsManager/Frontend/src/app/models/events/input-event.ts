import { IEvent } from './event-interface';
import { TargetKind, TargetSelectors } from './target-meta';

export class InputEvent implements IEvent {
    public type: string = 'input';
    public id: string;
    public timestamp: Date;
    public controlType: string;
    public value: string;
    public checked: boolean;
    public selectedText?: string;
    public targetKind?: TargetKind;
    public selectors?: TargetSelectors;
    public tag?: string | null;
    public fullViewBase64?: string;

    constructor(
        id: string,
        timestamp: Date,
        controlType: string,
        value: string,
        checked: boolean,
        selectedText?: string,
        targetKind?: TargetKind,
        selectors?: TargetSelectors,
        tag?: string | null,
        fullViewBase64?: string
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.controlType = controlType;
        this.value = value;
        this.checked = checked;
        this.selectedText = selectedText;
        this.targetKind = targetKind;
        this.selectors = selectors;
        this.tag = tag;
        this.fullViewBase64 = fullViewBase64;
    }
}
