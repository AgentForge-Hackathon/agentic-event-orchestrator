import { Router } from 'express';
import type { Response } from 'express';
import {
  requireAuth,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import ItineraryModel from '../../mongodb/models/Itinerary.js';

const router = Router();

/**
 * GET /api/itineraries
 *
 * Returns the authenticated user's itineraries from MongoDB, newest first.
 * Queries are fast because the `createdBy` field is indexed on the collection.
 */
router.get(
  '/',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const itineraries = await ItineraryModel
        .find({ createdBy: req.user!.id })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();       // returns plain JS objects — faster than full Mongoose documents

      res.json({ itineraries, total: itineraries.length });
    } catch (err) {
      console.error('[itineraries] Failed to fetch from MongoDB:', err);
      res.status(500).json({ error: 'Failed to fetch itineraries' });
    }
  },
);

export { router as itinerariesRouter };
