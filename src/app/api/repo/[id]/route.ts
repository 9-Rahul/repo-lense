import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    // Because of onDelete: Cascade in schema.prisma, this will automatically
    // delete all associated Files and Chunks as well.
    await prisma.repository.delete({
      where: { id }
    });

    return NextResponse.json({ message: 'Repository deleted successfully' });
  } catch (error: any) {
    console.error('Delete repo error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete repository' }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    const repository = await prisma.repository.findUnique({
      where: { id }
    });

    if (!repository) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }

    return NextResponse.json(repository);
  } catch (error: any) {
    console.error('Get repo error:', error);
    return NextResponse.json({ error: error.message || 'Failed to get repository' }, { status: 500 });
  }
}
