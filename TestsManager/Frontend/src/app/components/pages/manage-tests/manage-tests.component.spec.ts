import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManageTestsComponent } from './manage-tests.component';

describe('ManageTestsComponent', () => {
  let component: ManageTestsComponent;
  let fixture: ComponentFixture<ManageTestsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManageTestsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ManageTestsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
