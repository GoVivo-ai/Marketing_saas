/**
 * Contact-priority constants shared by the server engine and the client
 * panel — kept free of server imports so the panel can bundle them.
 */

/**
 * Most leads one apply will send to the AI. ~2 s per 10-lead chunk with 8 in
 * flight → ~130 s, comfortably inside the server action's timeout.
 */
export const PRIORITY_AUDIENCE_CAP = 600;
/** A full match adds this many points on top of the lead's score. */
export const PRIORITY_MAX_BOOST = 50;
