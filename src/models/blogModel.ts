import mongoose, { Schema } from "mongoose";
import slugify from "slugify";
import { IBlogDocument } from "../types/blog.types";

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
  if (this.isModified("title")) {
    const baseSlug = slugify(this.title, {
      lower: true,
      strict: true,
    });

    const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
    this.slug = `${baseSlug}-${uniqueSuffix}`;
  }
});

blogSchema.index({ createdAt: -1 });
blogSchema.index({ author: 1, createdAt: -1 });

export default mongoose.model<IBlogDocument>("Blog", blogSchema);