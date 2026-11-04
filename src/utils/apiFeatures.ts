import { Document, Query } from "mongoose";

export interface QueryString {
  [key: string]: any;
  keyword?: string;
  page?: string;
  limit?: string;
  sort?: string;
  pincode?: string;
}

class ApiFeatures<T extends Document = any> {
  query: Query<T[], T>;
  queryString: QueryString;

  constructor(query: Query<T[], T>, queryString: QueryString) {
    this.query = query;
    this.queryString = queryString;
  }

  /**
   * 🔍 CASE-INSENSITIVE PARTIAL SUBSTRING SEARCH ENGINE
   * Replaces MongoDB $text search with ReDoS-safe case-insensitive regex matching.
   * Matches partial keywords (e.g. "alo" for "Aloe Vera", "ferti" for "Fertilizer")
   * across multiple searchable fields via an $or condition.
   *
   * @param fields Array of field names or comma-separated string (defaults to ["name", "category", "tags", "description"])
   */
  search(fields: string | string[] = ["name", "category", "tags", "description"]) {
    if (this.queryString.keyword && typeof this.queryString.keyword === "string") {
      const rawKeyword = this.queryString.keyword.trim();

      if (rawKeyword) {
        // 🛡️ RE-DOS & BUFFER OVERFLOW PROTECTION:
        // Cap search term length to 100 characters to prevent CPU exhaustion on massive input strings
        const truncatedKeyword = rawKeyword.slice(0, 100);

        // Escape all regular expression special characters to ensure literal substring matching:
        // . * + ? ^ $ { } ( ) | [ ] \
        const escapedKeyword = truncatedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Parse target searchable fields
        let targetFields: string[];
        if (Array.isArray(fields)) {
          targetFields = fields.length > 0 ? fields : ["name", "category", "tags", "description"];
        } else if (typeof fields === "string") {
          if (fields.includes(",")) {
            targetFields = fields.split(",").map((f) => f.trim()).filter(Boolean);
          } else if (fields === "name") {
            // Backward compatibility: expand legacy single "name" argument to primary searchable fields
            targetFields = ["name", "category", "tags", "description"];
          } else {
            targetFields = [fields.trim()];
          }
        } else {
          targetFields = ["name", "category", "tags", "description"];
        }

        // Construct $or regex conditions with 'i' (case-insensitive) flag
        const orConditions = targetFields.map((field) => ({
          [field]: {
            $regex: escapedKeyword,
            $options: "i",
          },
        }));

        // Merge with existing query filter cleanly
        const currentFilter = this.query.getFilter();
        if (currentFilter && currentFilter.$or) {
          // If query already has an $or condition (e.g. multi-vendor ID filter),
          // wrap in $and so MongoDB treats it as: (existing $or) AND (search $or)
          this.query = this.query.find({
            $and: [{ $or: orConditions }],
          } as any);
        } else {
          this.query = this.query.find({
            $or: orConditions,
          } as any);
        }
      }
    }
    return this;
  }

  /**
   * 🛠️ FILTER (Price, Ratings, Categories, etc. with Whitelist-Enforced NoSQL Injection Protection)
   */
  filter(allowedFieldsWhitelist: string[] = []) {
    const queryCopy = { ...this.queryString };

    // Remove framework, search, sorting, and pagination properties from the document filter pool
    const removeFields = ["keyword", "page", "limit", "pincode", "sort"];
    removeFields.forEach((field) => delete queryCopy[field]);

    // 🛡️ SANITIZATION LAYER: Strip unapproved keys and eliminate client-supplied MongoDB operators
    const cleanAndWhitelistObject = (obj: any, isRoot = true): any => {
      if (obj !== null && typeof obj === "object") {
        for (const key in obj) {
          // 1. Drop any MongoDB mathematical or conditional structural operators passed by client
          if (key.startsWith("$")) {
            delete obj[key];
            continue;
          }

          // 2. Enforce explicit schema attribute whitelisting at root filter criteria level if provided
          if (isRoot && allowedFieldsWhitelist.length > 0 && !allowedFieldsWhitelist.includes(key)) {
            delete obj[key];
            continue;
          }

          // Recursively sanitize inner nested properties safely (like gt / lt blocks)
          if (typeof obj[key] === "object") {
            cleanAndWhitelistObject(obj[key], false);
          }
        }
      }
      return obj;
    };

    const sanitizedCopy = cleanAndWhitelistObject(queryCopy, true);

    // Advanced filtering configuration substitution (gt, gte, lt, lte) safely applied
    let queryStr = JSON.stringify(sanitizedCopy);
    queryStr = queryStr.replace(/\b(gt|gte|lt|lte)\b/g, (match) => `$${match}`);

    this.query = this.query.find(JSON.parse(queryStr));
    return this;
  }

  /**
   * 🔃 SORTING
   * Applies sort order from query string (e.g. ?sort=-price,ratings) or default
   */
  sort(defaultSort: string | Record<string, 1 | -1> = "-createdAt") {
    if (this.queryString.sort && typeof this.queryString.sort === "string") {
      const sortBy = this.queryString.sort.split(",").join(" ");
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort(defaultSort);
    }
    return this;
  }

  /**
   * 📄 PAGINATION
   */
  pagination(resultsPerPage: number) {
    const currentPage = Number(this.queryString.page) || 1;
    const skip = resultsPerPage * (currentPage - 1);

    this.query = this.query.limit(resultsPerPage).skip(skip);
    return this;
  }
}

export default ApiFeatures;
