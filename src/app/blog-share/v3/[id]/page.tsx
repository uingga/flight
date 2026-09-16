import BlogSharePage, { generateMetadata as generateBlogMetadata } from '../../[id]/page';
import BlogHomeShare, { metadata as homeMetadata } from '../../page';

type Props = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata(props: Props) {
    const { id } = await props.params;
    const metadata = id === 'home' ? homeMetadata : await generateBlogMetadata(props);
    return { ...metadata, alternates: { canonical: `/blog-share/v3/${id}` } };
}

export default async function MobileSafeBlogShare(props: Props) {
    return (await props.params).id === 'home' ? BlogHomeShare(props) : BlogSharePage(props);
}
