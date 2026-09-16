import BlogSharePage, { generateMetadata as generateBlogMetadata } from '../../[id]/page';

type Props = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata(props: Props) {
    const metadata = await generateBlogMetadata(props);
    const { id } = await props.params;
    return { ...metadata, alternates: { canonical: `/blog-share/v2/${id}` } };
}

export default BlogSharePage;
