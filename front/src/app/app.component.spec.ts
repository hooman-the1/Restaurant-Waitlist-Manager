import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    })
  );

  it('renders the shared semantic shell', () => {
    const fixture = TestBed.createComponent(AppComponent);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('header')?.textContent?.trim()).toBe(
      'Restaurant Waitlist Manager'
    );
    expect(element.querySelectorAll('main').length).toBe(1);
    expect(element.querySelector('main router-outlet')).not.toBeNull();
    expect(element.querySelector('footer')?.textContent?.trim()).toBe(
      'Restaurant Waitlist Manager'
    );
    expect(element.querySelector('header a, header button')).toBeNull();
    expect(element.querySelector('footer')?.children.length).toBe(0);
  });
});
