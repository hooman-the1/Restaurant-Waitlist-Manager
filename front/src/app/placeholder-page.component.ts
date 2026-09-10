import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-placeholder-page',
  standalone: true,
  template: '<h1>{{ heading }}</h1>'
})
export class PlaceholderPageComponent {
  readonly heading = inject(ActivatedRoute).snapshot.data['heading'] as string;
}
