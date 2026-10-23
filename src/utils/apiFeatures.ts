import { Document, Query } from "mongoose";

interface QueryString {
  [key: string]: any;
  keyword?: string;
  page?: string;
  limit?: string;
}

class ApiFeatures<T extends Document> {
  query: Query<T[], T>;
  queryString: QueryString;

  constructor(query: Query<T[], T>, queryString: QueryString) {
    this.query = query;
    this.queryString = queryString;
  }

  // 🔍 SECURE TEXT SEARCH ENGINE (With ReDoS Protection & Chain Preservation)
  search(field: string = "name") {
    if (this.queryString.keyword) {
      const rawKeyword = this.queryString.keyword.trim();

      if (rawKeyword) {
        // 🚀 STRATEGY 1: Full-Text Indexes ($text)
        if (field === "name" || field === "category") {
          this.query = this.query.find({
            $text: { $search: rawKeyword },
          });
        } else {
          // 🛡️ STRATEGY 2: SAFE REGEX FALLBACK (ReDoS Immunization)
          const escapedKeyword = rawKeyword.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");

          this.query = this.query.find({
            [field]: {
              $regex: escapedKeyword,
              $options: "i",
            },
          });
        }
      }
    }
    return this;
  }

  // 🛠️ FILTER (Price, Ratings, Categories, etc. with Whitelist-Enforced NoSQL Injection Protection)
  filter(allowedFieldsWhitelist: string[] = []) {
    const queryCopy = { ...this.queryString };

    // Remove framework/pagination properties from filter pool
    const removeFields = ["keyword", "page", "limit", "pincode"];
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

          // 2. FIXED: Enforce explicit schema attribute whitelisting at root filter criteria level
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

  // 📄 PAGINATION 
  pagination(resultsPerPage: number) {
    const currentPage = Number(this.queryString.page) || 1;
    const skip = resultsPerPage * (currentPage - 1);

    this.query = this.query.limit(resultsPerPage).skip(skip);
    return this;
  }
}

export default ApiFeatures;