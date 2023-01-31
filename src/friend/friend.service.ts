import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FRIEND_SCHEMA, FriendDocument } from './entities/friend.entity';
import { Model } from 'mongoose';
import { FOLLOW_USER_SCHEMA, FollowUserDocument } from '../follow-user/entities/follow-user.entity';
import { CatchError, ExceptionResponse } from '../utils/utils.error';
import { BOOLEAN, CONTACT_TYPE } from '../enum';
import { BaseResponse } from '../response';
import { FriendResponse } from '../response/friend.response';
import { USER_SCHEMA, UserDocument } from '../user/entities/user.entity';

@Injectable()
export class FriendService {
  constructor(
    @InjectModel(FRIEND_SCHEMA) private friendDocument: Model<FriendDocument>,
    @InjectModel(FOLLOW_USER_SCHEMA) private followUserDocumentDocument: Model<FollowUserDocument>,
    @InjectModel(USER_SCHEMA) private userDocumentModel: Model<UserDocument>,
  ) {}

  async handleAddFollow(user_id: string, target_id: string) {
    const existsFollow = await this.followUserDocumentDocument.findOne({
      user_id: target_id,
      follower_id: user_id,
    });

    if (!existsFollow) {
      const newFollow = new this.followUserDocumentDocument({
        user_id: target_id,
        follower_id: user_id,
      });

      await newFollow.save();

      await this.userDocumentModel.findByIdAndUpdate(target_id, { $inc: { no_of_followers: 1 } });
    }
  }

  async handleUpdateNoOfFriends(user_id: string, target_id: string) {
    await this.userDocumentModel.findByIdAndUpdate(user_id, { $inc: { no_of_friends: 1 } });
    await this.userDocumentModel.findByIdAndUpdate(target_id, { $inc: { no_of_friends: 1 } });
  }

  async addFriend(user_id: string, target_id: string) {
    try {
      const existsFriend = await this.friendDocument.findOne({
        sender_id: {
          $in: [user_id, target_id],
        },
        receiver_id: {
          $in: [user_id, target_id],
        },
      });

      if (!existsFriend) {
        const newFriend = new this.friendDocument({ sender_id: user_id, receiver_id: target_id });

        await newFriend.save();

        await this.handleAddFollow(user_id, target_id);

        return new BaseResponse({ message: 'Add friend successfully' });
      }

      if (existsFriend.status === BOOLEAN.TRUE) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'You are already friends');
      }

      if (existsFriend.sender_id.toString() === user_id) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'You have sent an invitation to this person');
      }

      if (existsFriend.receiver_id.toString() === user_id) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'You have received an invitation from this person');
      }
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async removeFriend(user_id: string, target_id: string) {
    try {
      const existsFriend = await this.friendDocument.findOne({
        sender_id: {
          $in: [user_id, target_id],
        },
        receiver_id: {
          $in: [user_id, target_id],
        },
        status: BOOLEAN.TRUE,
      });

      if (!existsFriend) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'You are not friends');
      }

      await this.friendDocument.deleteOne({
        _id: existsFriend._id,
      });

      return new BaseResponse({ message: 'Remove friend successfully' });
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async revokeRequest(user_id: string, target_id: string) {
    try {
      const existsFriend = await this.friendDocument.findOne({
        sender_id: user_id,
        receiver_id: target_id,
        status: BOOLEAN.FALSE,
      });

      if (!existsFriend) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'Request does not exist');
      }

      await this.friendDocument.deleteOne({
        _id: existsFriend._id,
      });

      return new BaseResponse({ message: 'Revoke request successfully' });
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async acceptRequest(user_id: string, target_id: string) {
    try {
      const exitFriend = await this.friendDocument.findOne({
        sender_id: target_id,
        receiver_id: user_id,
        status: BOOLEAN.FALSE,
      });
      if (!exitFriend) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'Request does not exist');
      }

      await this.friendDocument.findByIdAndUpdate(exitFriend._id, { status: BOOLEAN.TRUE });

      await this.handleAddFollow(user_id, target_id);
      await this.handleUpdateNoOfFriends(user_id, target_id);
      return new BaseResponse({ message: 'Accept request successfully' });
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async deniedRequest(user_id: string, target_id: string) {
    try {
      const exitFriend = await this.friendDocument.findOne({
        sender_id: target_id,
        receiver_id: user_id,
        status: BOOLEAN.FALSE,
      });
      if (!exitFriend) {
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'Request does not exist');
      }
      await this.friendDocument.findByIdAndDelete(exitFriend._id);
      return new BaseResponse({ message: 'Denied request successfully' });
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async getFriend(user_id: string, target_id: string) {
    try {
      console.log(target_id);
      const existsFriend = await this.friendDocument
        .find({ $or: [{ receiver_id: target_id }, { sender_id: target_id }], status: BOOLEAN.TRUE })
        .populate({ path: 'sender_id', select: '-password', match: { _id: { $ne: target_id } } })
        .populate({ path: 'receiver_id', select: '-password', match: { _id: { $ne: target_id } } })
        .exec();

      if (!existsFriend) {
        return new BaseResponse({ data: [] });
      }

      const data = existsFriend.map((item: any) => ({
        ...new FriendResponse(item.sender_id ? item.sender_id : item.receiver_id),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));

      const mapList = await Promise.all(
        data.map(async (item) => {
          const type = await this.getContactType(user_id, item._id);
          return {
            ...item,
            type: type.type,
          };
        }),
      );

      return new BaseResponse({ data: mapList });
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async getContactType(user_id: string, target_id: string) {
    try {
      const existsFriend = await this.friendDocument.findOne({
        $or: [
          { sender_id: user_id, receiver_id: target_id },
          { sender_id: target_id, receiver_id: user_id },
        ],
      });

      if (!existsFriend) {
        return {
          type: CONTACT_TYPE.NONE,
        };
      }

      if (existsFriend.status === BOOLEAN.TRUE) {
        return {
          type: CONTACT_TYPE.FRIEND,
        };
      }

      if (existsFriend.sender_id.toString() === user_id) {
        return {
          type: CONTACT_TYPE.REQUEST,
        };
      }

      if (existsFriend.receiver_id.toString() === user_id) {
        return {
          type: CONTACT_TYPE.PENDING,
        };
      }
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async getFriendRequest(user_id: string) {
    try {
      const requestFriend = await this.friendDocument
        .find({
          sender_id: user_id,
          status: BOOLEAN.FALSE,
        })
        .populate('receiver_id', '-password');

      if (!requestFriend) {
        return new BaseResponse({ data: [] });
      }

      const mapList = requestFriend.map((item: any) => {
        return {
          ...new FriendResponse(item.receiver_id),
          type: CONTACT_TYPE.REQUEST,
        };
      });
      return new BaseResponse({ data: mapList });
    } catch (error) {
      throw new CatchError(error);
    }
  }

  async getFriendReceive(user_id: string) {
    try {
      const requestFriend = await this.friendDocument
        .find({
          receiver_id: user_id,
          status: BOOLEAN.FALSE,
        })
        .populate('sender_id', '-password');
      if (!requestFriend) {
        return new BaseResponse({ data: [] });
      }
      const mapList = requestFriend.map((item: any) => {
        return {
          ...new FriendResponse(item.sender_id),
          type: CONTACT_TYPE.PENDING,
        };
      });
      return new BaseResponse({ data: mapList });
    } catch (error) {
      throw new CatchError(error);
    }
  }
}
