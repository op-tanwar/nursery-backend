import mongoose, { Schema } from "mongoose";
import { IBlogDocument } from "../types/blog.types";
import { handleDocumentSlug } from "../utils/slugify";

const blogSchema = new Schema<IBlogDocument>(
  {
    title: {
      type: String,
      required: [true, "Blog title is required"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    slugHistory: {
      type: [String],
      default: [],
      index: true,
    },
    content: {
      type: String,
      required: [true, "Blog content is required"],
    },
    author: {
      type: Schema.Types.ObjectId,
      required: [true, "Author reference id is required"],
      ref: "User",
    },
    authorType: {
      type: String,
      required: true,
      enum: ["Admin", "Nursery"],
    },
    coverImage: {
      type: String,
      required: [true, "Blog cover image is required"],
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    views: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

blogSchema.pre<IBlogDocument>("save", async function () {
  await handleDocumentSlug(this, {
    sourceField: "title",
    entityType: "Blog",
    suffixLength: 6,
  });
});

blogSchema.index({ slugHistory: 1 });
blogSchema.index({ createdAt: -1 });
blogSchema.index({ author: 1, createdAt: -1 });

export default mongoose.model<IBlogDocument>("Blog", blogSchema);