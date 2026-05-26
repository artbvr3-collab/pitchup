/**
 * MODULE: match_lifecycle.composition
 * PURPOSE: Composition root for the `match_lifecycle` bounded context. Wires
 *          concrete repositories into application services that `app/`
 *          (Server Components, Route Handlers) imports directly.
 * LAYER: composition (cross-layer wiring)
 * DEPENDENCIES: ./application/*, ./infrastructure/*
 * CONSUMED BY: app/(public)/games/page.tsx (Layer 2),
 *              future Route Handlers (Layer 3+).
 * INVARIANTS:
 *   - Imported only from `app/`. Never from `domain/` or `application/`
 *     (would invert the dependency direction).
 * RELATED DOCS: docs/ARCHITECTURE.md §3 (dependency direction).
 */
import { CreateMatchService } from "./application/create-match-service";
import { ListDiscoverMatchesService } from "./application/list-discover-matches";
import { ListVenuesService } from "./application/list-venues-service";
import { matchRepository, venueRepository } from "./infrastructure/repositories";

export const listDiscoverMatchesService = new ListDiscoverMatchesService(
  matchRepository,
);

export const createMatchService = new CreateMatchService(
  matchRepository,
  venueRepository,
);

export const listVenuesService = new ListVenuesService(venueRepository);
